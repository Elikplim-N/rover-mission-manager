/*
  Maize Rover: Phase 2 Master Firmware (Arduino Uno R4 WiFi)
  Local-First Mission Control with Optional Cloud Sync for Analysis

  Operational State Machine:
  [BOOT] -> [IDLE: awaiting config/start] -> [AUTO: mission running] <---> [PAUSED]
                                                     |         |
                                                [MANUAL] <-----+
                                                     |
                                                  [ESTOP] (reachable from any state)

  Features:
  - Local mission configuration and lifecycle control over the port-8080 command
    server: config, start_mission, pause_mission, resume_mission, status
  - Status endpoint returns the latest telemetry snapshot and mission progress so a
    companion app on the same local network can poll and log data on-device, with
    no internet connection required
  - Cloud telemetry push to the Dokploy Ingestion API is optional (off by default)
    and only used for later analysis when a connection happens to be available
  - Immediate Remote E-Stop override (Zero PWM, pump kill, acoustic alarm)
  - Manual Directional Nudge (Forward, Reverse, Left, Right, Stop) with 600ms deadman timeout
  - Actuator Diagnostic Test Bench (Single Seed Pulse, Water Dose 400ms, Arm Toggle)
  - Embedded WiFiServer on Port 8080 for low-latency (<20ms) direct commands
  - Bosch BME280 Tare Baseline Calibration for Relative Terrain Elevation (Elev)
  - Ultrasonic Obstacle Collision Avoidance & MPU-6050 Pitch/Roll
*/

#include <Wire.h>
#include <Servo.h>
#include <math.h>
#include <TinyGPSPlus.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
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
// NETWORK & DOKPLOY SERVER CONFIGURATION
// =========================================================================
const char* WIFI_SSID     = "Your_Farm_WiFi_or_Hotspot";
const char* WIFI_PASS     = "Your_WiFi_Password";

// Dokploy Cloud API Host (PostgreSQL 18.6 backend)
const char* DOKPLOY_HOST  = "178.105.184.157";
const int   DOKPLOY_PORT  = 3001;
const char* MISSION_ID    = "active-field-run";

// Embedded Command Server for Local Subnet Teleop & E-Stop
WiFiServer cmdServer(8080);
WiFiClient wifiClient;

// =========================================================================
// I2C ADDRESSES
// =========================================================================
#define COMPASS_ADDR      0x1E  // 0x1E for HMC5883L, 0x0D for QMC5883L
#define MPU6050_ADDR      0x68

// =========================================================================
// PIN DEFINITIONS (No SD Card Contention)
// =========================================================================
#define MOISTURE_PIN      A0
#define VOLTAGE_PIN       A1
#define TRIG_PIN          A2
#define ECHO_PIN          A3

#define MOTOR_LEFT_RPWM   3
#define MOTOR_LEFT_EN     4   // Dedicated to Left Motor Enable
#define MOTOR_LEFT_LPWM   5
#define MOTOR_RIGHT_RPWM  6
#define PUMP_RELAY_PIN    7   // Active LOW relay for water pump
#define MOTOR_RIGHT_EN    8   // Dedicated to Right Motor Enable
#define MOTOR_RIGHT_LPWM  9 
#define SEED_SERVO_PIN    10  // Dispenser hopper gate
#define BUZZER_PIN        11  // Audio alert / obstacle buzzer
#define ARM_SERVO_PIN     12  // Articulated soil tool
#define RGB_PIN           13  // WS2812B Status Indicator

// =========================================================================
// FIELD GEOMETRY & TUNING (runtime-configurable via /cmd?action=config...)
// =========================================================================
#define NUM_LEDS           8
int   BASE_SPEED      = 190;
int   TURN_SPEED      = 150;
float DROP_SPACING_M  = 0.25;
float ROW_SPACING_M   = 0.75;
int   DROPS_PER_ROW   = 20;
int   TOTAL_ROWS      = 10;
int   MOIST_THRESHOLD = 450;
const unsigned long DRIVE_DEADMAN_TIMEOUT = 600; // Auto-stop motors after 600ms of silence

// Mission lifecycle state
bool missionActive     = false; // true once start_mission has been called
bool missionComplete   = false; // true once TOTAL_ROWS has been fully covered
bool cloudSyncEnabled  = false; // Off by default: local-first, cloud push is optional

// Objects
TinyGPSPlus gps;
Adafruit_BME280 bme;
Adafruit_NeoPixel strip(NUM_LEDS, RGB_PIN, NEO_GRB + NEO_KHZ800);
Servo seedServo;
Servo armServo;

// State Variables
int currentRow = 1;
int currentDrop = 0;
float baselineAltitude = 0.0;
unsigned long lastDropTime = 0;
unsigned long lastWiFiRetry = 0;
unsigned long lastDriveCommandTime = 0;
bool isArmDeployed = false;

// Latest telemetry snapshot, exposed via /cmd?action=status so a companion app on
// the local network can poll it and log each drop on-device without any cloud
// connection. telemetrySeq increments once per drop so the app can tell whether a
// poll returned a new reading or the same one as last time.
unsigned long telemetrySeq = 0;
float lastSynX = 0, lastSynY = 0, lastVolt = 0, lastTempC = 0, lastHum = 0, lastPress = 0, lastElev = 0;
int   lastMoist = 0;
bool  lastWatered = false;
float lastAbsHead = 0, lastErr = 0, lastPitch = 0, lastRoll = 0, lastLat = 0, lastLng = 0, lastObsDist = 0;
int   lastSats = 0;

// =========================================================================
// SETUP
// =========================================================================
void setup() {
  Serial.begin(115200);
  Serial1.begin(9600); // GPS
  Wire.begin();

  // Pin Configurations
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  
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

  // Servos
  seedServo.attach(SEED_SERVO_PIN);
  armServo.attach(ARM_SERVO_PIN);
  seedServo.write(0);  // Gate closed
  armServo.write(90);  // Transit clearance

  // NeoPixels
  strip.begin();
  setRGBColor(strip.Color(255, 120, 0)); // Amber: Booting
  strip.show();

  // Wake up MPU-6050
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission(true);

  // BME280 Init & Barometric Altitude Tare
  bool bmeReady = bme.begin(0x76);
  if (!bmeReady) bmeReady = bme.begin(0x77);

  if (bmeReady) {
    float altSum = 0.0;
    for (int i = 0; i < 12; i++) {
      altSum += bme.readAltitude(1013.25);
      delay(25);
    }
    baselineAltitude = altSum / 12.0;
  }

  // Connect Wi-Fi & Launch Command Server
  connectWiFi();
  cmdServer.begin();

  // Acoustic Ready Chime
  tone(BUZZER_PIN, 1200, 120);
  delay(140);
  tone(BUZZER_PIN, 1800, 180);
  setRGBColor(strip.Color(0, 120, 255)); // Blue: idle, awaiting mission config/start from the app
  strip.show();

  Serial.println("Row,Drop,SynX,SynY,Volt,TempC,Hum,Press,Elev,Moist,Watered,AbsHead,Err,Pitch,Roll,Lat,Lng,Sats,ObsDist");
}

// =========================================================================
// MAIN LOOP
// =========================================================================
void loop() {
  // 1. Process GPS stream
  while (Serial1.available() > 0) {
    gps.encode(Serial1.read());
  }

  // 2. Wi-Fi reconnection guardian
  if (WiFi.status() != WL_CONNECTED && millis() - lastWiFiRetry > 10000) {
    lastWiFiRetry = millis();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }

  // 3. Process Remote Teleop & E-Stop HTTP Commands
  handleIncomingCommands();

  // 4. State Machine Branching
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

      // Collision avoidance
      float obsDist = readUltrasonicCM();
      if (obsDist > 0 && obsDist < 20.0) {
        stopMotors();
        setRGBColor(strip.Color(255, 0, 0));
        tone(BUZZER_PIN, 900, 60);
        delay(80);
        return;
      }

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
    stopMotors();
    digitalWrite(PUMP_RELAY_PIN, HIGH);
    tone(BUZZER_PIN, 1200, 500);
    Serial.println("[ESTOP] EMERGENCY STOP ACTIVATED!");
  }
  else if (action == "clear_estop") {
    currentMode = MODE_MANUAL;
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
  else if (action == "test_arm" && currentMode != MODE_ESTOP) {
    isArmDeployed = !isArmDeployed;
    armServo.write(isArmDeployed ? 0 : 90);
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
    v = getParam(req, "cloud");    if (v.length()) cloudSyncEnabled = (v == "1");
    Serial.println("[CONFIG] rows=" + String(TOTAL_ROWS) + " drops=" + String(DROPS_PER_ROW) +
                    " dropDist=" + String(DROP_SPACING_M) + " rowGap=" + String(ROW_SPACING_M) +
                    " moist=" + String(MOIST_THRESHOLD) + " speed=" + String(BASE_SPEED) +
                    " turn=" + String(TURN_SPEED) + " cloud=" + String(cloudSyncEnabled));
  }
  else if (action == "start_mission" && currentMode != MODE_ESTOP) {
    currentRow = 1;
    currentDrop = 0;
    missionActive = true;
    missionComplete = false;
    lastDropTime = millis();
    currentMode = MODE_AUTO;
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
           ",\"obsDist\":" + String(lastObsDist, 1) + "}";
  } else {
    resp = "{\"ok\":true,\"mode\":\"" + modeStr + "\",\"action\":\"" + action + "\"}";
  }

  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: application/json");
  client.println("Access-Control-Allow-Origin: *");
  client.println("Connection: close");
  client.println("Content-Length: " + String(resp.length()));
  client.println();
  client.println(resp);
  client.stop();
}

// =========================================================================
// MOTOR DRIVE FUNCTIONS
// =========================================================================
void driveForward() {
  analogWrite(MOTOR_LEFT_RPWM, BASE_SPEED);
  analogWrite(MOTOR_LEFT_LPWM, 0);
  analogWrite(MOTOR_RIGHT_RPWM, BASE_SPEED);
  analogWrite(MOTOR_RIGHT_LPWM, 0);
}

void driveReverse() {
  analogWrite(MOTOR_LEFT_RPWM, 0);
  analogWrite(MOTOR_LEFT_LPWM, BASE_SPEED);
  analogWrite(MOTOR_RIGHT_RPWM, 0);
  analogWrite(MOTOR_RIGHT_LPWM, BASE_SPEED);
}

void pivotLeft() {
  analogWrite(MOTOR_LEFT_RPWM, 0);
  analogWrite(MOTOR_LEFT_LPWM, TURN_SPEED);
  analogWrite(MOTOR_RIGHT_RPWM, TURN_SPEED);
  analogWrite(MOTOR_RIGHT_LPWM, 0);
}

void pivotRight() {
  analogWrite(MOTOR_LEFT_RPWM, TURN_SPEED);
  analogWrite(MOTOR_LEFT_LPWM, 0);
  analogWrite(MOTOR_RIGHT_RPWM, 0);
  analogWrite(MOTOR_RIGHT_LPWM, TURN_SPEED);
}

void stopMotors() {
  analogWrite(MOTOR_LEFT_RPWM, 0);
  analogWrite(MOTOR_LEFT_LPWM, 0);
  analogWrite(MOTOR_RIGHT_RPWM, 0);
  analogWrite(MOTOR_RIGHT_LPWM, 0);
}

void actuateSeedDrop() {
  seedServo.write(60);
  delay(180);
  seedServo.write(0);
}

// =========================================================================
// PLANTING & CLOUD TELEMETRY PIPELINE
// =========================================================================
void executePlantingDrop() {
  currentDrop++;
  if (currentDrop > DROPS_PER_ROW) {
    currentDrop = 1;
    currentRow++;
  }

  float synX = (currentRow % 2 != 0)
    ? (currentDrop - 1) * DROP_SPACING_M
    : (DROPS_PER_ROW - currentDrop) * DROP_SPACING_M;
  float synY = (currentRow - 1) * ROW_SPACING_M;

  float obsDist = readUltrasonicCM();
  float tempC = bme.readTemperature();
  float hum   = bme.readHumidity();
  float press = bme.readPressure() / 100.0F;
  float currentAlt = bme.readAltitude(1013.25);
  float elev = currentAlt - baselineAltitude;

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

  float absHead = readCompassHeading();
  float targetHead = (currentRow % 2 != 0) ? 90.0 : 270.0;
  float err = absHead - targetHead;
  if (err > 180.0) err -= 360.0;
  if (err < -180.0) err += 360.0;

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
                     String(obsDist, 1);
  Serial.println(csvRecord);

  // 2. Update the latest-telemetry snapshot for the local /cmd?action=status
  //    endpoint, so a companion app on the same network can poll it and log
  //    each drop on-device without needing any cloud connection.
  telemetrySeq++;
  lastSynX = synX; lastSynY = synY; lastVolt = volt; lastTempC = tempC; lastHum = hum;
  lastPress = press; lastElev = elev; lastMoist = moist; lastWatered = watered;
  lastAbsHead = absHead; lastErr = err; lastPitch = pitch; lastRoll = roll;
  lastLat = lat; lastLng = lng; lastSats = sats; lastObsDist = obsDist;

  // 3. Optionally push to the Dokploy cloud API, only when a connection is
  //    expected to be available; this is for later analysis and is never
  //    required for the mission itself to run or be logged locally.
  if (cloudSyncEnabled) {
    streamToDokployCloud(currentRow, currentDrop, synX, synY, volt, tempC, hum, press, elev, moist, watered, absHead, err, pitch, roll, lat, lng, sats, obsDist);
  }
}

void streamToDokployCloud(int row, int drop, float synX, float synY, float volt, float tempC, float hum, float press, float elev, int moist, bool watered, float absHead, float err, float pitch, float roll, float lat, float lng, int sats, float obsDist) {
  if (WiFi.status() != WL_CONNECTED) return;

  if (wifiClient.connect(DOKPLOY_HOST, DOKPLOY_PORT)) {
    String jsonPayload = "{\"missionId\":\"" + String(MISSION_ID) + "\"" +
                         ",\"row\":" + String(row) +
                         ",\"drop\":" + String(drop) +
                         ",\"synX\":" + String(synX, 2) +
                         ",\"synY\":" + String(synY, 2) +
                         ",\"volt\":" + String(volt, 2) +
                         ",\"tempC\":" + String(tempC, 1) +
                         ",\"hum\":" + String(hum, 1) +
                         ",\"press\":" + String(press, 1) +
                         ",\"elev\":" + String(elev, 2) +
                         ",\"moist\":" + String(moist) +
                         ",\"watered\":" + (watered ? "true" : "false") +
                         ",\"absHead\":" + String(absHead, 1) +
                         ",\"err\":" + String(err, 1) +
                         ",\"pitch\":" + String(pitch, 1) +
                         ",\"roll\":" + String(roll, 1) +
                         ",\"lat\":" + String(lat, 6) +
                         ",\"lng\":" + String(lng, 6) +
                         ",\"sats\":" + String(sats) +
                         ",\"obsDist\":" + String(obsDist, 1) + "}";

    wifiClient.println("POST /api/telemetry HTTP/1.1");
    wifiClient.println("Host: " + String(DOKPLOY_HOST) + ":" + String(DOKPLOY_PORT));
    wifiClient.println("Content-Type: application/json");
    wifiClient.println("Content-Length: " + String(jsonPayload.length()));
    wifiClient.println("Connection: close");
    wifiClient.println();
    wifiClient.println(jsonPayload);
    
    wifiClient.stop();
  }
}

// =========================================================================
// HARDWARE SENSORS & DRIVERS
// =========================================================================
void connectWiFi() {
  if (WiFi.status() == WL_NO_MODULE) return;

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 8) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    delay(2000);
    attempts++;
  }
}

float readUltrasonicCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 25000);
  if (duration == 0) return 999.0;
  return (duration * 0.0343) / 2.0;
}

void readMPU6050(float &pitch, float &roll) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU6050_ADDR, 6, true);

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

float readCompassHeading() {
  Wire.beginTransmission(COMPASS_ADDR);
  Wire.write(0x03);
  Wire.endTransmission(false);
  Wire.requestFrom(COMPASS_ADDR, 6, true);

  if (Wire.available() >= 6) {
    int16_t x = Wire.read() << 8 | Wire.read();
    int16_t z = Wire.read() << 8 | Wire.read();
    int16_t y = Wire.read() << 8 | Wire.read();

    float heading = atan2(y, x) * 180.0 / M_PI;
    if (heading < 0) heading += 360.0;
    return heading;
  }
  return 0.0;
}

void setRGBColor(uint32_t color) {
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}
