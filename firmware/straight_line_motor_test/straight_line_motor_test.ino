/*
 * =========================================================================
 * Straight Line Motor Diagnostic Test (Dual BTS7960 / IBT-2 / L298N)
 * Target: Arduino Uno R4 WiFi / Uno R3
 * 
 * FIXED HARDWARE WIRING:
 *  - Left Driver:   RPWM = 3, LPWM = 5, EN = 4
 *  - Right Driver:  RPWM = 6, LPWM = 9, EN = 8
 * 
 * Test Routine:
 *  - 5-cycle Straight Line Test:
 *      1. Drive STRAIGHT FORWARD for 2.0 seconds
 *      2. Full STOP for 1.5 seconds
 *      3. Repeat exactly 5 times
 *  - Complete safe shutdown when finished.
 * 
 * Open Serial Monitor at 115200 baud to follow along.
 * =========================================================================
 */

// =========================================================================
// 1. FIXED PIN DEFINITIONS (DO NOT CHANGE - MATCHED TO YOUR HARDWARE)
// =========================================================================
const uint8_t L_RPWM = 3;
const uint8_t L_LPWM = 5;
const uint8_t L_R_EN = 4;
const uint8_t L_L_EN = 4;

const uint8_t R_RPWM = 6;
const uint8_t R_LPWM = 9;
const uint8_t R_R_EN = 8;
const uint8_t R_L_EN = 8;

// =========================================================================
// 2. MOTOR PARAMETERS & INVERSION
// =========================================================================
// If either side spins in reverse during forward test, toggle its invert flag
const bool LEFT_INVERT  = false;
const bool RIGHT_INVERT = true;  // Opposing motor mounted on right chassis

// Speed: 0 (stopped) to 255 (max). 200 provides strong torque.
const int DRIVE_SPEED = 200;

const int TOTAL_CYCLES       = 5;
const unsigned long RUN_MS   = 2000; // 2.0 seconds forward
const unsigned long PAUSE_MS = 1500; // 1.5 seconds stop

// =========================================================================
// 3. LOW-LEVEL MOTOR DRIVER FUNCTIONS
// =========================================================================

void enableDrivers(bool enable) {
  uint8_t state = enable ? HIGH : LOW;
  digitalWrite(L_R_EN, state);
  digitalWrite(L_L_EN, state);
  digitalWrite(R_R_EN, state);
  digitalWrite(R_L_EN, state);
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

void driveStraight(int speed) {
  driveSide(L_RPWM, L_LPWM, speed, LEFT_INVERT);
  driveSide(R_RPWM, R_LPWM, speed, RIGHT_INVERT);
}

void stopMotors() {
  driveSide(L_RPWM, L_LPWM, 0, false);
  driveSide(R_RPWM, R_LPWM, 0, false);
}

// =========================================================================
// 4. SETUP & TEST EXECUTION
// =========================================================================

void setup() {
  Serial.begin(115200);
  delay(1200);

  Serial.println(F("\n============================================="));
  Serial.println(F("  STRAIGHT LINE MOTOR TEST (5 CYCLES)"));
  Serial.println(F("  FIXED PINOUT: Left=3,5 (EN=4) | Right=6,9 (EN=8)"));
  Serial.println(F("============================================="));
  Serial.print(F("Parameters: Speed=")); Serial.print(DRIVE_SPEED);
  Serial.print(F(" | Run=")); Serial.print(RUN_MS / 1000.0, 1);
  Serial.print(F("s | Pause=")); Serial.print(PAUSE_MS / 1000.0, 1);
  Serial.print(F("s | Cycles=")); Serial.println(TOTAL_CYCLES);
  Serial.println(F("---------------------------------------------"));

  // 1. Initialize Driver Pins as Outputs
  pinMode(L_RPWM, OUTPUT);
  pinMode(L_LPWM, OUTPUT);
  pinMode(L_R_EN, OUTPUT);
  pinMode(L_L_EN, OUTPUT);

  pinMode(R_RPWM, OUTPUT);
  pinMode(R_LPWM, OUTPUT);
  pinMode(R_R_EN, OUTPUT);
  pinMode(R_L_EN, OUTPUT);

  pinMode(LED_BUILTIN, OUTPUT);

  // 2. Start with motors completely off
  stopMotors();

  // 3. Drive Enable Pins HIGH (Powers the H-Bridge output stage)
  enableDrivers(true);
  Serial.println(F("[PINS] Left Enable (Pin 4) & Right Enable (Pin 8) = HIGH"));

  // 4. 3-second safety countdown
  Serial.println(F("[SAFETY] Starting test in 3 seconds..."));
  for (int i = 3; i > 0; i--) {
    Serial.print(F("  Countdown: "));
    Serial.println(i);
    digitalWrite(LED_BUILTIN, HIGH);
    delay(200);
    digitalWrite(LED_BUILTIN, LOW);
    delay(800);
  }

  // 5. Execute 5 Cycles: 2s Forward -> 1.5s Stop
  for (int cycle = 1; cycle <= TOTAL_CYCLES; cycle++) {
    Serial.print(F("\n>>> [CYCLE "));
    Serial.print(cycle);
    Serial.print(F("/"));
    Serial.print(TOTAL_CYCLES);
    Serial.println(F("] DRIVING FORWARD (2 seconds)..."));

    digitalWrite(LED_BUILTIN, HIGH);
    driveStraight(DRIVE_SPEED);
    delay(RUN_MS);

    Serial.print(F(">>> [CYCLE "));
    Serial.print(cycle);
    Serial.print(F("/"));
    Serial.print(TOTAL_CYCLES);
    Serial.println(F("] STOP (1.5 seconds)..."));

    stopMotors();
    digitalWrite(LED_BUILTIN, LOW);
    delay(PAUSE_MS);
  }

  // 6. Test Finished: Safely cut enable pins and motor PWM
  enableDrivers(false);
  stopMotors();

  Serial.println(F("\n============================================="));
  Serial.println(F("  SUCCESS: All 5 cycles completed!"));
  Serial.println(F("  Motors safely disabled and shut down."));
  Serial.println(F("=============================================\n"));
}

void loop() {
  // Idle: Keep motors completely off
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
