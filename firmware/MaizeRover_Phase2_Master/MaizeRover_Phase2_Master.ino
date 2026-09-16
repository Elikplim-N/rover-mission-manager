/*
  Maize Rover: Phase 3 Master Firmware (Arduino Uno R4 WiFi)
  Local-First Mission Control, No Internet Required in the Field

  The rover hosts its own WiFi network (Access Point mode) at a fixed address,
  192.168.4.1, instead of joining a farm/phone hotspot. A phone or laptop
  connects directly to that network and talks to the rover over the LAN — there
  is no dependency on mobile data, a nearby router, or a phone's hotspot staying
  awake. Completed missions are logged on the connecting device and can be
  pushed to the cloud afterward, from the app, whenever a connection happens to
  be available; the rover itself never needs one.

  Operational State Machine:
  [BOOT] -> [IDLE: awaiting config/start] -> [AUTO: mission running] <---> [PAUSED]
                                                     |         |
                                                [MANUAL] <-----+
                                                     |
                                                  [ESTOP] (reachable from any state)

  Features:
  - Autonomous boustrophedon driving between planting points: a dual-MPU-6050
    architecture replaces the compass (magnetometers are notoriously noisy this
    close to brushed-DC drive motors). MPU #1 (0x68) provides gyro Z-rate,
    integrated into a local relative-yaw-hold PID (P+I+D against 0 deg drift
    for the current straight segment) and into a running globalYaw estimate
    used only for telemetry/logging (reset to 0 at the start of every mission).
    MPU #2 (0x69) provides Z-axis accelerometer deviation from 1g, used as a
    terrain-roughness/shock metric. Interruptible by E-Stop and pause at every
    control tick, not just between drops. Kp/Ki/Kd/max-correction are
    runtime-tunable via /cmd?action=config so field tuning never needs a reflash.
  - Local mission configuration and lifecycle control over the port-8080 command
    server: config, start_mission, pause_mission, resume_mission, status
  - Status endpoint returns the latest telemetry snapshot and mission progress so a
    companion app on the same local network can poll and log data on-device, with
    no internet connection required
  - Immediate Remote E-Stop override (Zero PWM, pump kill, acoustic alarm)
  - Manual Directional Nudge (Forward, Reverse, Left, Right, Stop) with 600ms deadman timeout
  - Actuator Diagnostic Test Bench (Single Seed Pulse, Water Dose 400ms)
  - Embedded WiFiServer on Port 8080 for low-latency (<20ms) direct commands
  - MPU-6050 Pitch/Roll and MPU-6050 Terrain Roughness (peak Z-axis shock per
    straight-line segment)

  NOTE: The BME280 (temperature/humidity/pressure/elevation) and HMC5883L/
  QMC5883L compass have been removed from this hardware revision. Their
  telemetry/CSV fields are kept in place (always reporting 0) rather than
  deleted, so the companion app's status JSON contract doesn't break.
  The ultrasonic obstacle sensor and the soil-probe arm servo have also been
  physically removed from this hardware revision; unlike the BME280/compass
  fields, their telemetry (obsDist) and command (test_arm) have been deleted
  outright rather than zeroed, since a fake "0cm to obstacle" reading would be
  actively misleading rather than just unavailable.
*/

#include <Wire.h>
#include <Servo.h>
#include <math.h>
#include <TinyGPSPlus.h>
#include <Adafruit_NeoPixel.h>
#include <WiFiS3.h>

// =========================================================================
// OPERATIONAL STATE MACHINE DEFINITIONS
// =========================================================================
enum RoverMode {
  MODE_IDLE,      // Awaiting mission configuration and start command from the app
  MODE_AUTO,      // Mission running: autonomous furrow traversal & planting
  MODE_PAUSED,    // Mission interrupted mid-run; holds position, resumable
  MODE_MANUAL,    // Operator teleop & actuator diagnostics
  MODE_ESTOP      // Emergency stop: all power cut, pump off, alarm
};

RoverMode currentMode = MODE_IDLE;

// =========================================================================
// NETWORK CONFIGURATION (Access Point mode)
// =========================================================================
// The rover hosts its own network rather than joining one, so the connecting
// phone/laptop always finds it at the same address (192.168.4.1, assigned by
// the WiFiS3 library's default AP configuration) with no router or mobile
// hotspot involved. Change the password below before field deployment;
// WPA2 requires 8-63 characters.
const char* AP_SSID       = "MaizeRover-Field01";
const char* AP_PASSWORD   = "PlantMaize1";

// Embedded Command Server for Local Subnet Teleop & E-Stop
WiFiServer cmdServer(8080);

// =========================================================================
// I2C ADDRESSES
// =========================================================================
#define MPU_STEERING      0x68  // Gyro Z-rate: closed-loop straight-line hold + turn tracking
#define MPU_ROUGHNESS     0x69  // Z-axis accelerometer: terrain roughness / shock sensing

// =========================================================================
// PIN DEFINITIONS (No SD Card Contention)
// =========================================================================
#define MOISTURE_PIN      A0
#define VOLTAGE_PIN       A1

#define MOTOR_LEFT_RPWM   3
#define MOTOR_LEFT_EN     4   // Dedicated to Left Motor Enable
#define MOTOR_LEFT_LPWM   5
#define MOTOR_RIGHT_RPWM  6
#define PUMP_RELAY_PIN    7   // Active LOW relay for water pump
#define MOTOR_RIGHT_EN    8   // Dedicated to Right Motor Enable
#define MOTOR_RIGHT_LPWM  9
#define SEED_SERVO_PIN    10  // Dispenser hopper gate
#define BUZZER_PIN        11  // Audio alert / obstacle buzzer
#define RGB_PIN           13  // WS2812B Status Indicator

// =========================================================================
// FIELD GEOMETRY & TUNING (runtime-configurable via /cmd?action=config...)
// =========================================================================
#define NUM_LEDS           8
int         BASE_SPEED     = 100;
int         TURN_SPEED     = 100;
const bool  LEFT_INVERT    = false;
const bool  RIGHT_INVERT   = true;  // Opposing motor mounted on right chassis
float       DROP_SPACING_M = 0.25;
float       ROW_SPACING_M  = 0.75;
int         DROPS_PER_ROW  = 20;
int         TOTAL_ROWS     = 10;
int         MOIST_THRESHOLD= 450;
const unsigned long DRIVE_DEADMAN_TIMEOUT = 600; // Auto-stop motors after 600ms of silence

// Closed-loop straight-line driving: local relative-yaw hold (P) + accumulated
// error (I) + yaw-rate derivative (D) against the MPU_STEERING gyro, runtime-
// configurable via /cmd?action=config so gains can be tuned in the field
// without reflashing. Bench-tuned for the low BASE_SPEED above.
float       Kp             = 3.5;
float       Ki             = 0.05;
float       Kd             = 1.0;
int         MAX_CORRECTION = 30;      // Dropped from 55 to prevent low-speed stalling
float       EARLY_TURN_CUTOFF = 2.0;  // Stop actively driving this many degrees early and coast the rest -- prevents low-speed turn overshoot

// Time-based distance estimate (no wheel encoders): milliseconds of
// BASE_SPEED driving to cover one meter, calibrated empirically on the bench.
// Re-measure if BASE_SPEED, wheels, gearing, or battery voltage change --
// these two are independently tuned because the row-gap crossing includes
// the U-turn's own settling and isn't simply proportional to the per-drop one.
const float MS_PER_METER_DROP    = 8000.0;
const float MS_PER_METER_ROW_GAP = 4000.0;
const float PIVOT_ANGLE_DEG      = 90.0; // Row-to-row U-turn is two of these

// Mission lifecycle state
bool missionActive     = false; // true once start_mission has been called
bool missionComplete   = false; // true once TOTAL_ROWS has been fully covered

// Objects
TinyGPSPlus gps;
Adafruit_NeoPixel strip(NUM_LEDS, RGB_PIN, NEO_GRB + NEO_KHZ800);
Servo seedServo;

// State Variables
int currentRow = 1;
int currentDrop = 0;
unsigned long lastDropTime = 0;
unsigned long lastDriveCommandTime = 0;

// Closed-loop navigation state
float gyroZOffset   = 0.0;  // Measured at boot; subtract from raw gyro Z to get real rate
float globalYaw     = 0.0;  // Accumulated heading since boot -- acts as a drift-prone "digital compass" now that the magnetometer (noisy near the drive motors) has been removed. Telemetry/logging only; steering itself holds local relative yaw, not this.
float maxRoughness  = 0.0;  // Peak Z-axis shock measured during the current straight-line segment
float lastPIDError  = 0.0;  // Most recent local-yaw error from the last driveStraightPID poll, exposed as telemetry "err"

// Latest telemetry snapshot, exposed via /cmd?action=status so a companion app on
// the local network can poll it and log each drop on-device. telemetrySeq
// increments once per drop so the app can tell whether a poll returned a new
// reading or the same one as last time. tempC/hum/press/elev are always 0
// now that the BME280 has been removed from this hardware revision -- kept
// in the JSON shape rather than deleted so the app doesn't need to change.
unsigned long telemetrySeq = 0;
float lastSynX = 0, lastSynY = 0, lastVolt = 0, lastTempC = 0, lastHum = 0, lastPress = 0, lastElev = 0;
int   lastMoist = 0;
bool  lastWatered = false;
float lastAbsHead = 0, lastErr = 0, lastPitch = 0, lastRoll = 0, lastLat = 0, lastLng = 0;
float lastRoughness = 0;
int   lastSats = 0;

// =========================================================================
// SETUP
// =========================================================================
void setup() {
  Serial.begin(115200);
  Serial1.begin(9600); // GPS
  Wire.begin();

  // Pin Configurations
  pinMode(MOTOR_LEFT_EN, OUTPUT);
  pinMode(MOTOR_RIGHT_EN, OUTPUT);
  digitalWrite(MOTOR_LEFT_EN, HIGH);
  digitalWrite(MOTOR_RIGHT_EN, HIGH);

  pinMode(MOTOR_LEFT_RPWM, OUTPUT);
  pinMode(MOTOR_LEFT_LPWM, OUTPUT);
  pinMode(MOTOR_RIGHT_RPWM, OUTPUT);
  pinMode(MOTOR_RIGHT_LPWM, OUTPUT);

  pinMode(PUMP_RELAY_PIN, OUTPUT);
  digitalWrite(PUMP_RELAY_PIN, HIGH); // Turn off pump (Active LOW)

  pinMode(BUZZER_PIN, OUTPUT);

  // Servo
  seedServo.attach(SEED_SERVO_PIN);
  seedServo.write(0);  // Gate closed

  // NeoPixels
  strip.begin();
  setRGBColor(strip.Color(255, 120, 0)); // Amber: Booting
  strip.show();

  // Wake up both MPU-6050s. 0x68 drives closed-loop steering (gyro Z) and
  // needs the low-pass filter + full-scale range configured for clean rate
  // readings; 0x69 only ever reads the raw Z-axis accelerometer for shock
  // sensing, so its power-on defaults are fine once it's out of sleep.
  Wire.beginTransmission(MPU_STEERING);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission(true);
  Wire.beginTransmission(MPU_STEERING); Wire.write(0x1A); Wire.write(0x03); Wire.endTransmission(); // 44Hz digital low-pass filter
  Wire.beginTransmission(MPU_STEERING); Wire.write(0x1B); Wire.write(0x00); Wire.endTransmission(); // +/-250 deg/s full scale

  Wire.beginTransmission(MPU_ROUGHNESS);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission(true);

  // Gyro Z-axis calibration: average the drift while stationary so
  // readGyroZRate() can report true angular velocity, not sensor bias.
  Serial.println(F("[NAV] Calibrating gyro, keep the rover still..."));
  float gyroSum = 0.0;
  for (int i = 0; i < 200; i++) {
    gyroSum += readRawGyroZ();
    delay(5);
  }
  gyroZOffset = gyroSum / 200.0;
  Serial.println(F("[NAV] Gyro calibrated."));

  // Host the local Access Point & Launch Command Server
  setupAccessPoint();
  cmdServer.begin();

  // Acoustic Ready Chime
  tone(BUZZER_PIN, 1200, 120);
  delay(140);
  tone(BUZZER_PIN, 1800, 180);
  setRGBColor(strip.Color(0, 120, 255)); // Blue: idle, awaiting mission config/start from the app
  strip.show();

  Serial.println("Row,Drop,SynX,SynY,Volt,TempC,Hum,Press,Elev,Moist,Watered,AbsHead,Err,Pitch,Roll,Lat,Lng,Sats,Roughness");
}

// =========================================================================
// MAIN LOOP
// =========================================================================
void loop() {
  // 1. Process GPS stream
  while (Serial1.available() > 0) {
    gps.encode(Serial1.read());
  }

  // 2. Process Remote Teleop & E-Stop HTTP Commands
  handleIncomingCommands();

  // 3. State Machine Branching
  switch (currentMode) {
    case MODE_ESTOP:
      // Safety Lockdown: 0% PWM, forced pump cut
      stopMotors();
      digitalWrite(PUMP_RELAY_PIN, HIGH);
      // Warning strobe
      if ((millis() / 250) % 2 == 0) {
        setRGBColor(strip.Color(255, 0, 0));
        tone(BUZZER_PIN, 1000, 50);
      } else {
        setRGBColor(strip.Color(0, 0, 0));
      }
      break;

    case MODE_MANUAL:
      // Manual Override: Deadman timeout safety
      if (millis() - lastDriveCommandTime > DRIVE_DEADMAN_TIMEOUT) {
        stopMotors();
      }
      setRGBColor(strip.Color(255, 140, 0)); // Solid Amber
      break;

    case MODE_IDLE:
      // Awaiting a config + start_mission command from the app. Motors stay off.
      stopMotors();
      setRGBColor(strip.Color(0, 120, 255)); // Blue: idle
      break;

    case MODE_PAUSED:
      // Mission interrupted mid-run. Position (currentRow/currentDrop) is held
      // so resume_mission can continue from exactly where it left off.
      stopMotors();
      setRGBColor(strip.Color(255, 200, 0)); // Amber-yellow: paused
      break;

    case MODE_AUTO:
    default: {
      setRGBColor(strip.Color(0, 255, 0)); // Solid Green

      // Mission-complete check: currentRow only advances past TOTAL_ROWS once
      // the last row's final drop has been executed.
      if (currentRow > TOTAL_ROWS) {
        stopMotors();
        missionActive = false;
        missionComplete = true;
        currentMode = MODE_IDLE;
        tone(BUZZER_PIN, 1500, 150);
        delay(160);
        tone(BUZZER_PIN, 2000, 200);
        Serial.println("[MISSION] Complete.");
        return;
      }

      // Autonomous Furrow Cycle (every 2.5s)
      if (millis() - lastDropTime >= 2500) {
        lastDropTime = millis();
        executePlantingDrop();
      }
      break;
    }
  }
}

// =========================================================================
// COMMAND SERVER & TELEOP HANDLER (PORT 8080)
// =========================================================================

// Extracts the value of a query-string key (e.g. "rows" from "...&rows=10&...").
// Returns "" if the key isn't present in the request.
String getParam(String req, String key) {
  String pattern = key + "=";
  int idx = req.indexOf(pattern);
  if (idx == -1) return "";
  idx += pattern.length();
  int end = idx;
  while (end < (int)req.length() && req[end] != '&' && req[end] != ' ') end++;
  return req.substring(idx, end);
}

void handleIncomingCommands() {
  WiFiClient client = cmdServer.available();
  if (!client) return;

  String req = "";
  unsigned long timeout = millis() + 500;
  while (client.connected() && millis() < timeout) {
    if (client.available()) {
      char c = client.read();
      req += c;
      if (req.endsWith("\r\n\r\n")) break;
    }
  }

  // Parse action query parameter: /cmd?action=...
  int actionIndex = req.indexOf("action=");
  String action = "";
  if (actionIndex != -1) {
    int spaceIndex = req.indexOf(" ", actionIndex);
    int andIndex = req.indexOf("&", actionIndex);
    int endIndex = (andIndex != -1 && andIndex < spaceIndex) ? andIndex : spaceIndex;
    action = req.substring(actionIndex + 7, endIndex);
    action.toLowerCase();
  }

  // Execute Command
  if (action == "estop") {
    currentMode = MODE_ESTOP;
    enableDrivers(false);
    stopMotors();
    digitalWrite(PUMP_RELAY_PIN, HIGH);
    tone(BUZZER_PIN, 1200, 500);
    Serial.println("[ESTOP] EMERGENCY STOP ACTIVATED!");
  }
  else if (action == "clear_estop") {
    currentMode = MODE_MANUAL;
    enableDrivers(true);
    stopMotors();
    noTone(BUZZER_PIN);
    Serial.println("[ESTOP] Cleared to MANUAL mode.");
  }
  else if (action == "resume_auto") {
    currentMode = MODE_AUTO;
    Serial.println("[MODE] Resumed AUTONOMOUS mission.");
  }
  else if (action == "forward" && currentMode != MODE_ESTOP) {
    currentMode = MODE_MANUAL;
    driveForward();
    lastDriveCommandTime = millis();
  }
  else if (action == "reverse" && currentMode != MODE_ESTOP) {
    currentMode = MODE_MANUAL;
    driveReverse();
    lastDriveCommandTime = millis();
  }
  else if (action == "left" && currentMode != MODE_ESTOP) {
    currentMode = MODE_MANUAL;
    pivotLeft();
    lastDriveCommandTime = millis();
  }
  else if (action == "right" && currentMode != MODE_ESTOP) {
    currentMode = MODE_MANUAL;
    pivotRight();
    lastDriveCommandTime = millis();
  }
  else if (action == "stop") {
    stopMotors();
    lastDriveCommandTime = 0;
  }
  else if (action == "test_seed" && currentMode != MODE_ESTOP) {
    actuateSeedDrop();
  }
  else if (action == "test_water" && currentMode != MODE_ESTOP) {
    digitalWrite(PUMP_RELAY_PIN, LOW);
    delay(400);
    digitalWrite(PUMP_RELAY_PIN, HIGH);
  }
  else if (action == "config") {
    // All parameters optional; only the ones present in the request are updated.
    String v;
    v = getParam(req, "rows");     if (v.length()) TOTAL_ROWS = v.toInt();
    v = getParam(req, "drops");    if (v.length()) DROPS_PER_ROW = v.toInt();
    v = getParam(req, "dropDist"); if (v.length()) DROP_SPACING_M = v.toFloat();
    v = getParam(req, "rowGap");   if (v.length()) ROW_SPACING_M = v.toFloat();
    v = getParam(req, "moist");    if (v.length()) MOIST_THRESHOLD = v.toInt();
    v = getParam(req, "speed");    if (v.length()) BASE_SPEED = v.toInt();
    v = getParam(req, "turn");     if (v.length()) TURN_SPEED = v.toInt();
    v = getParam(req, "kp");       if (v.length()) Kp = v.toFloat();
    v = getParam(req, "ki");       if (v.length()) Ki = v.toFloat();
    v = getParam(req, "kd");       if (v.length()) Kd = v.toFloat();
    v = getParam(req, "maxCorr");  if (v.length()) MAX_CORRECTION = v.toInt();
    Serial.println("[CONFIG] rows=" + String(TOTAL_ROWS) + " drops=" + String(DROPS_PER_ROW) +
                    " dropDist=" + String(DROP_SPACING_M) + " rowGap=" + String(ROW_SPACING_M) +
                    " moist=" + String(MOIST_THRESHOLD) + " speed=" + String(BASE_SPEED) +
                    " turn=" + String(TURN_SPEED) + " kp=" + String(Kp) + " ki=" + String(Ki) +
                    " kd=" + String(Kd) + " maxCorr=" + String(MAX_CORRECTION));
  }
  else if (action == "start_mission" && currentMode != MODE_ESTOP) {
    currentRow = 1;
    currentDrop = 0;
    missionActive = true;
    missionComplete = false;
    lastDropTime = millis();
    currentMode = MODE_AUTO;
    // No absolute heading to lock anymore -- driveStraightPID holds a fresh
    // local relative-yaw reference (0 deg) for every segment on its own.
    // globalYaw is reset here too, so each mission's logged/plotted heading
    // starts from 0 instead of carrying over drift from however long the
    // rover sat idle (or a previous mission) before this one started.
    globalYaw = 0.0;
    Serial.println("[MISSION] Started.");
  }
  else if (action == "pause_mission") {
    if (currentMode == MODE_AUTO) {
      currentMode = MODE_PAUSED;
      stopMotors();
      Serial.println("[MISSION] Paused at row " + String(currentRow) + " drop " + String(currentDrop));
    }
  }
  else if (action == "resume_mission" && currentMode != MODE_ESTOP) {
    if (missionActive && !missionComplete) {
      currentMode = MODE_AUTO;
      lastDropTime = millis();
      Serial.println("[MISSION] Resumed at row " + String(currentRow) + " drop " + String(currentDrop));
    }
  }
  // "status" needs no handling here: it has no side effects and just falls
  // through to the status JSON response built below.

  // Send JSON HTTP Response
  String modeStr = (currentMode == MODE_ESTOP) ? "ESTOP"
                  : (currentMode == MODE_PAUSED) ? "PAUSED"
                  : (currentMode == MODE_MANUAL) ? "MANUAL"
                  : (currentMode == MODE_IDLE) ? "IDLE"
                  : "AUTO";

  String resp;
  if (action == "status") {
    resp = "{\"ok\":true,\"mode\":\"" + modeStr + "\"" +
           ",\"missionActive\":" + (missionActive ? "true" : "false") +
           ",\"missionComplete\":" + (missionComplete ? "true" : "false") +
           ",\"row\":" + String(currentRow) +
           ",\"drop\":" + String(currentDrop) +
           ",\"totalRows\":" + String(TOTAL_ROWS) +
           ",\"dropsPerRow\":" + String(DROPS_PER_ROW) +
           ",\"seq\":" + String(telemetrySeq) +
           ",\"synX\":" + String(lastSynX, 2) +
           ",\"synY\":" + String(lastSynY, 2) +
           ",\"volt\":" + String(lastVolt, 2) +
           ",\"tempC\":" + String(lastTempC, 1) +
           ",\"hum\":" + String(lastHum, 1) +
           ",\"press\":" + String(lastPress, 1) +
           ",\"elev\":" + String(lastElev, 2) +
           ",\"moist\":" + String(lastMoist) +
           ",\"watered\":" + (lastWatered ? "true" : "false") +
           ",\"absHead\":" + String(lastAbsHead, 1) +
           ",\"err\":" + String(lastErr, 1) +
           ",\"pitch\":" + String(lastPitch, 1) +
           ",\"roll\":" + String(lastRoll, 1) +
           ",\"lat\":" + String(lastLat, 6) +
           ",\"lng\":" + String(lastLng, 6) +
           ",\"sats\":" + String(lastSats) +
           ",\"roughness\":" + String(lastRoughness, 3) + "}";
  } else {
    resp = "{\"ok\":true,\"mode\":\"" + modeStr + "\",\"action\":\"" + action + "\"}";
  }

  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: application/json");
  client.println("Access-Control-Allow-Origin: *");
  client.println("Connection: close");
  client.println("Content-Length: " + String(resp.length()));
  client.println();
  client.print(resp); // print, not println: Content-Length above must match the body exactly
  client.flush();     // ensure the body is actually sent over the air before the socket closes
  delay(1);
  client.stop();
}

// =========================================================================
// MOTOR DRIVE FUNCTIONS
// =========================================================================
void enableDrivers(bool enable) {
  uint8_t state = enable ? HIGH : LOW;
  digitalWrite(MOTOR_LEFT_EN, state);
  digitalWrite(MOTOR_RIGHT_EN, state);
}

void driveSide(uint8_t rpwmPin, uint8_t lpwmPin, int speed, bool invert) {
  if (invert) speed = -speed;
  speed = constrain(speed, -255, 255);

  if (speed > 0) {
    analogWrite(lpwmPin, 0);
    analogWrite(rpwmPin, speed);
  } else if (speed < 0) {
    analogWrite(rpwmPin, 0);
    analogWrite(lpwmPin, -speed);
  } else {
    analogWrite(rpwmPin, 0);
    analogWrite(lpwmPin, 0);
  }
}

void driveForward() {
  enableDrivers(true);
  driveSide(MOTOR_LEFT_RPWM, MOTOR_LEFT_LPWM, BASE_SPEED, LEFT_INVERT);
  driveSide(MOTOR_RIGHT_RPWM, MOTOR_RIGHT_LPWM, BASE_SPEED, RIGHT_INVERT);
}

void driveReverse() {
  enableDrivers(true);
  driveSide(MOTOR_LEFT_RPWM, MOTOR_LEFT_LPWM, -BASE_SPEED, LEFT_INVERT);
  driveSide(MOTOR_RIGHT_RPWM, MOTOR_RIGHT_LPWM, -BASE_SPEED, RIGHT_INVERT);
}

void pivotLeft() {
  enableDrivers(true);
  driveSide(MOTOR_LEFT_RPWM, MOTOR_LEFT_LPWM, -TURN_SPEED, LEFT_INVERT);
  driveSide(MOTOR_RIGHT_RPWM, MOTOR_RIGHT_LPWM, TURN_SPEED, RIGHT_INVERT);
}

void pivotRight() {
  enableDrivers(true);
  driveSide(MOTOR_LEFT_RPWM, MOTOR_LEFT_LPWM, TURN_SPEED, LEFT_INVERT);
  driveSide(MOTOR_RIGHT_RPWM, MOTOR_RIGHT_LPWM, -TURN_SPEED, RIGHT_INVERT);
}

void stopMotors() {
  driveSide(MOTOR_LEFT_RPWM, MOTOR_LEFT_LPWM, 0, false);
  driveSide(MOTOR_RIGHT_RPWM, MOTOR_RIGHT_LPWM, 0, false);
}

// =========================================================================
// AUTONOMOUS DRIVE ORCHESTRATION (bench-proven dual-MPU local-yaw PID loop)
// =========================================================================
// These block for multiple seconds at a time (there are no wheel encoders,
// so distance is time-based), so each one polls handleIncomingCommands()
// and currentMode on every iteration -- an E-Stop or pause mid-drive takes
// effect immediately instead of only being checked between drops. Returning
// false means "did not complete"; callers must not advance
// currentRow/currentDrop or treat the segment as having actually happened.

// Interruptible settle-pause used between pivot/drive steps in a row
// transition. A raw delay() here used to mean an E-Stop or pause mid-turn
// had to wait out the whole pause before taking effect; this polls commands
// and currentMode every 5ms instead so it stops immediately.
bool safeDelay(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    handleIncomingCommands();
    if (currentMode != MODE_AUTO) {
      stopMotors();
      return false;
    }
    delay(5);
  }
  return true;
}

// Drives straight for durationMs holding a fresh local relative-yaw reference
// (0 deg at the start of this call) via gyro-integrated P+I+D, since the
// magnetometer this used to reference is gone. Also polls the second MPU at
// 200Hz for peak terrain shock during the segment, exposed as "roughness".
bool driveStraightPID(unsigned long durationMs) {
  float pidIntegral = 0.0;
  float previousError = 0.0;
  float localYaw = 0.0;
  maxRoughness = 0.0; // Fresh peak-shock reading for this segment

  unsigned long start = millis();
  unsigned long lastShockPoll = millis();
  unsigned long lastPIDPoll = millis();
  unsigned long lastGyroT = micros();
  enableDrivers(true);

  while (millis() - start < durationMs) {
    handleIncomingCommands();
    if (currentMode != MODE_AUTO) {
      stopMotors();
      return false;
    }

    if (millis() - lastShockPoll >= 5) { // 200Hz roughness poll (MPU 0x69)
      lastShockPoll = millis();
      float currentShock = readZShockFromMPU2();
      if (currentShock > maxRoughness) maxRoughness = currentShock;
    }

    if (millis() - lastPIDPoll >= 20) { // 50Hz steering poll (MPU 0x68), matches the bench-tuned gains
      float dt = (millis() - lastPIDPoll) / 1000.0;
      lastPIDPoll = millis();

      unsigned long now = micros();
      float dtGyro = (now - lastGyroT) / 1000000.0;
      lastGyroT = now;
      float rate = readGyroZRate();
      localYaw += rate * dtGyro;
      globalYaw += rate * dtGyro;

      float error = localYaw;
      lastPIDError = error;
      float P = Kp * error;

      pidIntegral = constrain(pidIntegral + error * dt, -20.0, 20.0);
      float I = Ki * pidIntegral;

      float derivative = (error - previousError) / dt;
      float D = Kd * derivative;
      previousError = error;

      int correction = constrain((int)(P + I + D), -MAX_CORRECTION, MAX_CORRECTION);
      driveSide(MOTOR_LEFT_RPWM, MOTOR_LEFT_LPWM, BASE_SPEED + correction, LEFT_INVERT);
      driveSide(MOTOR_RIGHT_RPWM, MOTOR_RIGHT_LPWM, BASE_SPEED - correction, RIGHT_INVERT);
    }
  }
  stopMotors();
  return true;
}

// Pivots in place until the gyro reports ~targetDegrees of rotation, coasting
// the last EARLY_TURN_CUTOFF degrees to reduce low-speed overshoot.
// Autonomous-only: manual teleop's pivotLeft()/pivotRight() stay
// duration-based (deadman timeout) and are untouched by this.
bool pivotByGyroAngle(bool turnRight, float targetDegrees) {
  float turnedAngle = 0.0;
  unsigned long lastT = micros();

  if (turnRight) pivotRight(); else pivotLeft();

  while (fabs(turnedAngle) < (targetDegrees - EARLY_TURN_CUTOFF)) {
    handleIncomingCommands();
    if (currentMode != MODE_AUTO) {
      stopMotors();
      return false;
    }
    unsigned long now = micros();
    float dt = (now - lastT) / 1000000.0;
    lastT = now;
    float rate = readGyroZRate();
    turnedAngle += rate * dt;
    globalYaw += rate * dt; // keep the digital-yaw estimate in sync through turns too
    delayMicroseconds(5000);
  }
  stopMotors();
  return true;
}

// Row-to-row transition: pivot ~90 deg, cross the row gap, pivot ~90 deg
// again, ending up facing down the new row. Each driveStraightPID call holds
// its own fresh local-yaw reference, so there's no compass to re-lock between
// steps anymore -- just interruptible settle-pauses around each pivot.
bool performRowTransition(bool turnRight) {
  stopMotors();
  if (!safeDelay(300)) return false;

  if (!pivotByGyroAngle(turnRight, PIVOT_ANGLE_DEG)) return false;
  if (!safeDelay(400)) return false; // let the chassis settle before trusting the drive

  if (!driveStraightPID((unsigned long)(ROW_SPACING_M * MS_PER_METER_ROW_GAP))) return false;

  if (!pivotByGyroAngle(turnRight, PIVOT_ANGLE_DEG)) return false;
  if (!safeDelay(400)) return false;

  return true;
}

void actuateSeedDrop() {
  seedServo.write(60);
  delay(180);
  seedServo.write(0);
}

// =========================================================================
// PLANTING & LOCAL TELEMETRY PIPELINE
// =========================================================================
void executePlantingDrop() {
  // Work out where this drop lands without committing to it yet: if the
  // physical drive gets interrupted (E-Stop, pause, or an obstacle) partway
  // there, currentRow/currentDrop must stay at their previous values so
  // resume_mission retries this exact drop instead of skipping it.
  int targetDrop = currentDrop + 1;
  int targetRow = currentRow;
  bool newRow = false;
  if (targetDrop > DROPS_PER_ROW) {
    targetDrop = 1;
    targetRow = currentRow + 1;
    newRow = true;
  }

  if (newRow) {
    // Alternates with the row just finished, tracing a serpentine U-turn
    // that matches the boustrophedon direction already used for synX below.
    bool turnRight = (currentRow % 2 != 0);
    if (!performRowTransition(turnRight)) return; // interrupted; try again next tick
  }
  if (!driveStraightPID((unsigned long)(DROP_SPACING_M * MS_PER_METER_DROP))) return;

  // Physically arrived: now it's safe to commit the new position.
  currentDrop = targetDrop;
  currentRow = targetRow;

  float synX = (currentRow % 2 != 0)
    ? (currentDrop - 1) * DROP_SPACING_M
    : (DROPS_PER_ROW - currentDrop) * DROP_SPACING_M;
  float synY = (currentRow - 1) * ROW_SPACING_M;

  // BME280 removed from this hardware revision -- always report 0 rather
  // than deleting the fields, so the app's JSON contract doesn't break.
  float tempC = 0.0f, hum = 0.0f, press = 0.0f, elev = 0.0f;

  int moist = analogRead(MOISTURE_PIN);
  bool watered = false;
  if (moist < MOIST_THRESHOLD) {
    digitalWrite(PUMP_RELAY_PIN, LOW);
    watered = true;
  }

  float rawVolt = analogRead(VOLTAGE_PIN);
  float volt = (rawVolt * (5.0 / 1023.0)) * 5.0; // B25 voltage sensor module, 5:1 divider (0-25V range)

  float pitch = 0.0, roll = 0.0;
  readMPU6050(pitch, roll);

  float absHead = globalYaw;    // Accumulated gyro yaw since boot -- no magnetometer anymore
  float err = lastPIDError;     // Local-yaw error from the most recent steering poll
  float roughness = maxRoughness; // Peak shock measured during the drive segment just completed

  float lat = gps.location.isValid() ? gps.location.lat() : 0.0;
  float lng = gps.location.isValid() ? gps.location.lng() : 0.0;
  int sats  = gps.satellites.isValid() ? gps.satellites.value() : 0;

  actuateSeedDrop();

  if (watered) {
    delay(400);
    digitalWrite(PUMP_RELAY_PIN, HIGH);
  }

  // 1. Output to Serial
  String csvRecord = String(currentRow) + "," +
                     String(currentDrop) + "," +
                     String(synX, 2) + "," +
                     String(synY, 2) + "," +
                     String(volt, 2) + "," +
                     String(tempC, 1) + "," +
                     String(hum, 1) + "," +
                     String(press, 1) + "," +
                     String(elev, 2) + "," +
                     String(moist) + "," +
                     String(watered ? 1 : 0) + "," +
                     String(absHead, 1) + "," +
                     String(err, 1) + "," +
                     String(pitch, 1) + "," +
                     String(roll, 1) + "," +
                     String(lat, 6) + "," +
                     String(lng, 6) + "," +
                     String(sats) + "," +
                     String(roughness, 3);
  Serial.println(csvRecord);

  // 2. Update the latest-telemetry snapshot for the local /cmd?action=status
  //    endpoint, so a companion app on the same network can poll it and log
  //    each drop on-device. This is the only telemetry sink the rover itself
  //    writes to; pushing a completed mission to the cloud for analysis is
  //    done afterward, from the app, whenever it has an internet connection.
  //    Sanitized defensively: JSON has no NaN/Infinity literal, so any sensor
  //    read that comes back non-finite (missing/disconnected hardware) would
  //    otherwise corrupt this response and break every field in it, not just
  //    the one bad reading.
  telemetrySeq++;
  lastSynX = sanitize(synX); lastSynY = sanitize(synY); lastVolt = sanitize(volt);
  lastTempC = sanitize(tempC); lastHum = sanitize(hum); lastPress = sanitize(press);
  lastElev = sanitize(elev); lastMoist = moist; lastWatered = watered;
  lastAbsHead = sanitize(absHead); lastErr = sanitize(err); lastPitch = sanitize(pitch);
  lastRoll = sanitize(roll); lastLat = sanitize(lat); lastLng = sanitize(lng);
  lastSats = sats; lastRoughness = sanitize(roughness);
}

// =========================================================================
// HARDWARE SENSORS & DRIVERS
// =========================================================================
void setupAccessPoint() {
  if (WiFi.status() == WL_NO_MODULE) return;

  WiFi.beginAP(AP_SSID, AP_PASSWORD);
  delay(1000); // Let the AP interface come up before the command server binds to it

  Serial.print(F("[WIFI] Hosting access point \""));
  Serial.print(AP_SSID);
  Serial.println(F("\""));
  Serial.print(F("[WIFI] Connect to it, then reach the rover at http://"));
  Serial.println(WiFi.localIP());
}

// Replaces NaN/Infinity (e.g. from a disconnected sensor) with 0, since
// String(NaN) renders as the bare word "nan" -- not a valid JSON number --
// which would otherwise corrupt the entire /cmd?action=status response.
float sanitize(float v) {
  return (isnan(v) || isinf(v)) ? 0.0f : v;
}

void readMPU6050(float &pitch, float &roll) {
  Wire.beginTransmission(MPU_STEERING);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_STEERING, 6, true);

  if (Wire.available() >= 6) {
    int16_t ax = Wire.read() << 8 | Wire.read();
    int16_t ay = Wire.read() << 8 | Wire.read();
    int16_t az = Wire.read() << 8 | Wire.read();

    float axG = ax / 16384.0;
    float ayG = ay / 16384.0;
    float azG = az / 16384.0;

    pitch = atan2(-axG, sqrt(ayG * ayG + azG * azG)) * 180.0 / M_PI;
    roll  = atan2(ayG, azG) * 180.0 / M_PI;
  }
}

// MPU-6050 #2 (0x69), Z-axis accelerometer only: how far the Z reading
// deviates from 1g, used as a rough terrain/shock roughness metric.
float readZShockFromMPU2() {
  Wire.beginTransmission(MPU_ROUGHNESS);
  Wire.write(0x3F);
  if (Wire.endTransmission() != 0) {
    Serial.println("[WARN] MPU 0x69 disconnected!");
    return 0.0;
  }
  Wire.requestFrom((uint8_t)MPU_ROUGHNESS, (uint8_t)2);
  if (Wire.available() >= 2) {
    int16_t rawZ = Wire.read() << 8 | Wire.read();
    float azG = rawZ / 16384.0;
    return fabs(azG - 1.0);
  }
  return 0.0;
}

// MPU-6050 #1 (0x68) gyro Z-axis (yaw rate), used both for the straight-line
// PID loop and to track how far a U-turn has actually rotated.
float readRawGyroZ() {
  Wire.beginTransmission(MPU_STEERING);
  Wire.write(0x47);
  if (Wire.endTransmission(false) != 0) return gyroZOffset;

  Wire.requestFrom((uint8_t)MPU_STEERING, (uint8_t)2);
  if (Wire.available() >= 2) {
    int16_t rawZ = Wire.read() << 8 | Wire.read();
    return (float)rawZ / 131.0; // +/-250 deg/s full-scale sensitivity
  }
  return gyroZOffset;
}

float readGyroZRate() {
  float rate = readRawGyroZ() - gyroZOffset;
  if (fabs(rate) < 0.20) rate = 0.0; // Deadband: ignore stationary sensor noise
  return rate;
}

void setRGBColor(uint32_t color) {
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}
