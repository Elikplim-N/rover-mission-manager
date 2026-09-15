# Maize Rover: Phase 2 Master Firmware (Arduino Uno R4 WiFi)

## Architectural Model: Pure IoT Cloud-First (No SD Card)

This firmware implements a **Pure Cloud-First IoT Architecture**. Rather than relying on fragile physical MicroSD cards and SPI bus wiring, the rover leverages the **Arduino Uno R4 WiFi's onboard ESP32-S3 coprocessor** to stream live telemetry straight to your remote PostgreSQL server via Dokploy.

---

## Architectural Advantages of the No-SD-Card Design

1. **Elimination of Pin Contention**:
   - Standard SPI SD breakouts require pins D10 (CS), D11 (MOSI), D12 (MISO), and D13 (SCK).
   - In our rover, pins D10–D13 are dedicated to:
     - `D10`: Seed Dispenser Servo
     - `D11`: Active Buzzer
     - `D12`: Articulated Arm Servo
     - `D13`: WS2812B NeoPixel RGB
   - Eliminating the SD card frees pin `D4` completely for **Left Motor Enable (`MOTOR_LEFT_EN`)**, preventing pin conflicts and erratic motor behavior.
2. **Reduced Mechanical & Electrical Failure Points**:
   - SD card sockets frequently disconnect or corrupt files under high rover vibration over rough furrow soil.
   - Saves ~80mA current spikes from the 5V regulator.
3. **Live Remote Ingestion**:
   - Telemetry points land in PostgreSQL on `178.105.184.157:6000/rover-hub` instantaneously at every drop.
   - The web app dashboard visualizes real-time furrow progress and sensor telemetry without waiting for the mission to finish or manually transferring cards.

---

## Dual Telemetry Pipelines

1. **Pipeline 1 (Cloud Wi-Fi)**:
   - For every seed drop, constructs a JSON payload.
   - Dispatches an HTTP `POST /api/telemetry` over Wi-Fi / 4G Mobile Hotspot directly to your Dokploy server.
2. **Pipeline 2 (Local USB / Telemetry Radio)**:
   - Prints the standard 19-column CSV row at 115200 baud on USB Serial for local laptop debugging and radio receivers.

---

## Pinout Map

| Arduino Uno R4 Pin | Subsystem | Function |
| :--- | :--- | :--- |
| **A4 (SDA) / A5 (SCL)**| I2C Bus | BME280 (`0x76`), MPU-6050 (`0x68`), Compass (`0x1E`) |
| **A0** | Analog | Soil Moisture Probe |
| **A1** | Analog | Rover Battery Voltage Divider (B25 module, 5:1, 0-25V) |
| **A2 / A3** | GPIO / Timer | Ultrasonic HC-SR04 Trigger & Echo |
| **D3 / D5** | PWM | Left Motor RPWM / LPWM |
| **D4** | Digital Output | Left Motor Enable (`HIGH`) |
| **D6 / D9** | PWM | Right Motor RPWM / LPWM |
| **D7** | Digital Output | Water Pump Relay (Active LOW) |
| **D8** | Digital Output | Right Motor Enable (`HIGH`) |
| **D10** | PWM Servo | Seed Dropper Gate Servo |
| **D11** | Digital Output | Active Piezo Buzzer |
| **D12** | PWM Servo | Articulated Tool Arm Servo |
| **D13** | Digital Output | WS2812B NeoPixel Status LED Strip |
| **Serial1 (RX0/TX1)** | UART | TinyGPS++ GNSS Module @ 9600 Baud |

---

## Cloud Telemetry Ingestion Configuration

In `MaizeRover_Phase2_Master.ino`:
```cpp
const char* WIFI_SSID     = "Your_Farm_WiFi_or_Hotspot";
const char* WIFI_PASS     = "Your_WiFi_Password";
const char* CLOUD_HOST    = "rover-mission-manager-iota.vercel.app"; // Cloud API host
const int   CLOUD_PORT    = 443;                                     // Port 443 (HTTPS) or 80 (HTTP)
const bool  USE_HTTPS     = true;                                    // WiFiSSLClient enabled for Vercel
```
