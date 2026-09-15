# Maize Rover: Phase 2 Master Firmware (Arduino Uno R4 WiFi)

## Architectural Model: Local-First, No Internet Required in the Field

This firmware hosts its own WiFi network (Access Point mode) instead of joining a farm router or phone hotspot. A phone or laptop connects directly to the rover's network and controls it over the local subnet — mission configuration, start/pause/resume, manual teleop, and telemetry are all served from the rover itself at a fixed address, with no dependency on mobile data or an internet connection reaching the field. A completed mission is logged on the connecting device and can be pushed to the cloud afterward, from the app, purely for later analysis.

There is also no SD card. Rather than relying on fragile physical MicroSD cards and SPI bus wiring, the Arduino Uno R4 WiFi's pins that would otherwise be reserved for an SD breakout are freed up for actuators and status indicators.

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
3. **Local-First Mission Data**:
   - Every drop's telemetry is held on the rover in a live snapshot (`/cmd?action=status`) and logged by the connecting app straight to that device's own storage, with no server or connection required for the mission to run or be recorded.
   - A mission can be pushed to the cloud afterward, from the app, whenever it happens to have an internet connection — this is for later analysis only and is never on the rover's critical path.

---

## Telemetry Pipelines

1. **Pipeline 1 (Local Command/Status Server, Port 8080)**:
   - Serves mission lifecycle commands (`config`, `start_mission`, `pause_mission`, `resume_mission`, `status`) and manual teleop/E-Stop over the rover's own WiFi network.
   - `status` returns the latest telemetry snapshot and mission progress; a companion app polls this to log each drop on-device.
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

## Access Point Configuration

In `MaizeRover_Phase2_Master.ino`:
```cpp
const char* AP_SSID       = "MaizeRover-Field01";
const char* AP_PASSWORD   = "PlantMaize1";
```

Change the password before field deployment (WPA2 requires 8-63 characters). The rover always comes up at the same address, `192.168.4.1` — the WiFiS3 library's default for Access Point mode — so a phone or laptop just needs to join the `AP_SSID` network and open the app; there is no IP to look up.
