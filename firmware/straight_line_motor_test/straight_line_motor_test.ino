/*
 * =========================================================================
 * Straight Line Motor Diagnostic Test (Dual BTS7960 / IBT-2 / L298N)
 * Target: Arduino Uno R4 WiFi / Arduino Uno R3
 * 
 * Test Routine:
 *  - 5-cycle Straight Line Test:
 *      1. Drive STRAIGHT FORWARD for 2.0 seconds
 *      2. STOP for 1.5 seconds
 *      3. Repeat exactly 5 times
 *  - Full safe shutdown when finished.
 * 
 * Open Serial Monitor at 115200 baud to monitor each cycle.
 * =========================================================================
 */

// =========================================================================
// 1. PIN CONFIGURATION
// =========================================================================

// --- CONFIGURATION A: Standard Dual BTS7960 (from rover_square_test) ---
// If your rover is wired with this setup (Default):
const uint8_t L_RPWM = 10;
const uint8_t L_LPWM = 11;
const uint8_t L_R_EN = 12;
const uint8_t L_L_EN = 13;

const uint8_t R_RPWM = 5;
const uint8_t R_LPWM = 6;
const uint8_t R_R_EN = 7;
const uint8_t R_L_EN = 8;

/*
// --- CONFIGURATION B: Phase 2 Master Pinout ---
// (Uncomment this block and comment CONFIGURATION A if using Phase 2 wiring):
const uint8_t L_RPWM = 3;
const uint8_t L_LPWM = 5;
const uint8_t L_R_EN = 4;
const uint8_t L_L_EN = 4;

const uint8_t R_RPWM = 6;
const uint8_t R_LPWM = 9;
const uint8_t R_R_EN = 8;
const uint8_t R_L_EN = 8;
*/

// =========================================================================
// 2. MOTOR TUNING & INVERSION
// =========================================================================
// On rovers, motors face opposing directions. One side usually needs inversion.
const bool LEFT_INVERT  = false;
const bool RIGHT_INVERT = true;   // Flip to false if right side spins backward

// Drive Speed: 0 (stop) to 255 (max). 180 provides good starting torque.
const int DRIVE_SPEED = 180;

const int TOTAL_CYCLES       = 5;
const unsigned long RUN_MS   = 2000; // 2.0 seconds forward
const unsigned long PAUSE_MS = 1500; // 1.5 seconds pause

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
// 4. SETUP & INITIALIZATION
// =========================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println(F("\n========================================="));
  Serial.println(F("  STRAIGHT LINE MOTOR TEST (5 CYCLES)"));
  Serial.println(F("========================================="));
  Serial.println(F("Parameters:"));
  Serial.print(F("  - Speed: ")); Serial.println(DRIVE_SPEED);
  Serial.print(F("  - Forward Duration: ")); Serial.print(RUN_MS / 1000.0, 1); Serial.println(F(" s"));
  Serial.print(F("  - Pause Duration:   ")); Serial.print(PAUSE_MS / 1000.0, 1); Serial.println(F(" s"));
  Serial.print(F("  - Total Cycles:     ")); Serial.println(TOTAL_CYCLES);
  Serial.println(F("-----------------------------------------"));

  // Configure Output Pins
  pinMode(L_RPWM, OUTPUT);
  pinMode(L_LPWM, OUTPUT);
  pinMode(L_R_EN, OUTPUT);
  pinMode(L_L_EN, OUTPUT);

  pinMode(R_RPWM, OUTPUT);
  pinMode(R_LPWM, OUTPUT);
  pinMode(R_R_EN, OUTPUT);
  pinMode(R_L_EN, OUTPUT);

  pinMode(LED_BUILTIN, OUTPUT);

  // Ensure motors start OFF
  stopMotors();

  // Enable Driver Chips (BTS7960 Enable Pins HIGH)
  enableDrivers(true);
  Serial.println(F("[DRIVERS] Motor enable pins pulled HIGH."));

  // 3-second safety countdown before starting
  Serial.println(F("[SAFETY] Starting in 3 seconds... Stand clear!"));
  for (int i = 3; i > 0; i--) {
    Serial.print(F("  "));
    Serial.println(i);
    digitalWrite(LED_BUILTIN, HIGH);
    delay(200);
    digitalWrite(LED_BUILTIN, LOW);
    delay(800);
  }

  // =========================================================================
  // 5. RUN 5 CYCLES (2s FORWARD -> 1.5s STOP)
  // =========================================================================
  for (int cycle = 1; cycle <= TOTAL_CYCLES; cycle++) {
    Serial.print(F("\n>>> [CYCLE "));
    Serial.print(cycle);
    Serial.print(F("/"));
    Serial.print(TOTAL_CYCLES);
    Serial.println(F("] DRIVING STRAIGHT FORWARD (2 sec)..."));

    digitalWrite(LED_BUILTIN, HIGH);
    driveStraight(DRIVE_SPEED);
    delay(RUN_MS);

    Serial.print(F(">>> [CYCLE "));
    Serial.print(cycle);
    Serial.print(F("/"));
    Serial.print(TOTAL_CYCLES);
    Serial.println(F("] STOPPED (1.5 sec)..."));

    stopMotors();
    digitalWrite(LED_BUILTIN, LOW);
    delay(PAUSE_MS);
  }

  // Sequence Finished: Disable and cut all power
  enableDrivers(false);
  stopMotors();

  Serial.println(F("\n========================================="));
  Serial.println(F("  TEST COMPLETE: All 5 cycles finished!"));
  Serial.println(F("  Drivers disabled. Motors safely stopped."));
  Serial.println(F("=========================================\n"));
}

void loop() {
  // Safety idle loop - do nothing once test sequence is done
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
