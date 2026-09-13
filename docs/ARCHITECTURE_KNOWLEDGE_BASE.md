# Autonomous Maize Rover System: Architecture Knowledge Base

**System Name**: Autonomous Precision Agriculture Maize Rover Ecosystem  
**Target Platform**: Arduino Uno R4 (MCU), Dokploy PaaS (Cloud Ingestion & Database), Modern Web Workstation (Frontend 3D Digital Twin & Mission Management)  
**Document Classification**: Architectural Reference & Technical Knowledge Base

---

## 1. Executive System Overview & Core Architecture Axiom

> **Core Architectural Pipeline**:  
> **`Sensors → Arduino Uno R4 WiFi → Wi-Fi HTTP POST → Dokploy (Node.js/Express + PostgreSQL 18.6) → Web Workstation (Direct REST Pull)`**
>
> **Architectural Simplification**: Physical MicroSD card breakouts and manual CSV sneakernet file transfers are **eliminated**. All planting telemetry streams wirelessly over field Wi-Fi or a 4G mobile hotspot directly into the PostgreSQL cloud database, and the web workstation auto-pulls records via REST API for 3D terrain visualization and analytics.

The system consists of three primary architectural tiers:
1. **Edge Tier (Rover Cyber-Physical Unit)**: Renesas RA4M1 32-bit MCU + ESP32-S3 Wi-Fi (Arduino Uno R4 WiFi) capturing multi-spectral environmental, inertial, and geospatial telemetry and triggering PWM/relay actuators.
2. **Cloud Tier (Dokploy PaaS Infrastructure)**: Containerized Node.js/Express ingestion service and PostgreSQL 18.6 relational database hosted via Docker Compose on Dokploy (`178.105.184.157:6000/rover-hub`).
3. **Application Tier (Mission Manager Workstation)**: An offline-resilient, client-side web workstation built with React 19, TypeScript, Three.js, and Plotly, directly pulling missions from the Dokploy REST API to render 3D surface topography and furrow kinematics.

```mermaid
flowchart TB
    subgraph EdgeTier["Edge Tier: Maize Rover (Arduino Uno R4 WiFi)"]
        Sensors["Sensors: BME280, MPU-6050, Compass, GPS, Moisture, Ultrasonic"]
        Actuators["Actuators: Drive Motors, Seed Servo, Arm Servo, Water Pump"]
        MCU["Renesas RA4M1 MCU + ESP32-S3 Wi-Fi Coprocessor"]
        Sensors --> MCU
        MCU --> Actuators
    end

    subgraph TelemetryPipes["Telemetry Pipelines (Pure Cloud-First)"]
        SerialOut["Pipeline 2: USB / Radio Serial Stream (115200 Baud)"]
        WiFiOut["Pipeline 1: Real-Time HTTP POST /api/telemetry\n(Wi-Fi / 4G Mobile Hotspot)"]
        MCU --> SerialOut
        MCU --> WiFiOut
    end

    subgraph CloudTier["Cloud Tier: Dokploy PaaS (178.105.184.157:6000)"]
        DokployAPI["rover-api (Node.js 20 / Port 3001)"]
        PostgresDB[("PostgreSQL 18.6 Database\n(rover-hub: missions & telemetry_points)")]
        WiFiOut --> DokployAPI
        DokployAPI --> PostgresDB
    end

    subgraph AppTier["Application Tier: Mission Manager Workstation"]
        DexieDB[("Browser IndexedDB Cache\n(Dexie.js Offline Storage)")]
        ThreeD["Three.js 3D Digital Twin & Terrain Engine"]
        PlotlyAnalytics["Plotly.js Agronomic Analytics"]
        MissionSync["Dokploy Cloud Sync Client (src/lib/api.ts)"]

        PostgresDB <-->|REST API Sync| MissionSync
        SerialOut -.->|Serial CSV Import| DexieDB
        MissionSync --> DexieDB
        DexieDB --> ThreeD
        DexieDB --> PlotlyAnalytics
    end
```

---

## 2. Edge Tier Architecture (Firmware & Embedded Hardware)

### 2.1 Microcontroller Constraints & Pure Cloud-First Architecture

| Hardware Parameter | Specification | Architectural Consequence | Architectural Decision (Pure Cloud-First) |
| :--- | :--- | :--- | :--- |
| **Microcontroller** | Renesas RA4M1 (Arm Cortex-M4 @ 48 MHz) | 32-bit execution, native USB, FPU | Real-time trigonometric coordinate dead-reckoning and orientation filters. |
| **SRAM** | 32 KB | Volatile; erased upon battery disconnect | SRAM holds active loop state and network client buffers only. |
| **Data Flash (EEPROM)** | 8 KB | Limited to ~75 telemetry lines | Bypassed. Cannot store full field planting missions (500–2,000+ drops). |
| **Physical SD Card** | *Omitted by Design* | Pins D10–D13 conflict with servos/buzzer/LEDs; pin D4 needed for motor enable | **Eliminated**. Avoids SPI bus pin contention, eliminates mechanical vibration failure on rough soil, and saves ~80mA current spikes. |
| **Primary Telemetry** | ESP32-S3 Coprocessor (Uno R4 WiFi) | 2.4 GHz 802.11 b/g/n Wi-Fi | **Pure Cloud Streaming**: Real-time HTTP POST stream directly to Dokploy REST endpoint (`POST /api/telemetry`). |
| **Secondary Telemetry** | USB CDC Serial (115200 Baud) | Real-time CSV line printing | Live local workstation/field laptop telemetry mirror. |

### 2.2 Pinout & Peripheral Assignment

```
Arduino Uno R4 Pinout
├── I2C Bus (Pins A4/SDA, A5/SCL)
│   ├── Bosch BME280 (0x76/0x77): Ambient Temp, Humidity, Pressure, Barometric Altitude
│   ├── MPU-6050 6-DoF IMU (0x68): Pitch & Roll inclination angles
│   └── HMC5883L / QMC5883L (0x1E / 0x0D): Absolute compass heading
├── Analog Inputs
│   ├── A0: Soil Moisture Probe (0 - 1023 ADC raw resistance/capacitance)
│   ├── A1: Battery Voltage Divider (10k/10k divider network, 2x multiplier)
│   ├── A2: Ultrasonic Trigger (HC-SR04 pulse initiation)
│   └── A3: Ultrasonic Echo (HC-SR04 return pulse duration)
├── Actuators & Motor Control
│   ├── D3 (PWM): Left Motor Forward (RPWM)
│   ├── D4 (GPIO): Left Motor Enable / Remappable SPI CS
│   ├── D5 (PWM): Left Motor Reverse (LPWM)
│   ├── D6 (PWM): Right Motor Forward (RPWM)
│   ├── D7 (GPIO): Water Pump Relay (Active LOW actuation)
│   ├── D8 (GPIO): Right Motor Enable
│   ├── D9 (PWM): Right Motor Reverse (LPWM)
│   ├── D10 (PWM): Seed Dispenser Hopper Servo (0° closed, 60° open gate)
│   ├── D11 (PWM): Piezo Buzzer (acoustic system alert & obstacle warning)
│   ├── D12 (PWM): Articulated Tool Arm Servo (90° transit position)
│   └── D13 (GPIO): WS2812B NeoPixel RGB Status Array (Green = Run, Red = Obstacle, Amber = Init)
└── Serial Interfaces
    ├── Serial (USB CDC): Primary telemetry output stream @ 115200 Baud
    └── Serial1 (D0 RX, D1 TX): GNSS / GPS Receiver @ 9600 Baud (TinyGPS++)
```

### 2.3 Sensor Processing & Mathematical Transformations

1. **Relative Terrain Elevation (`Elev`)**:
   - Barometric pressure fluctuates by weather. An absolute altitude calculation shifts across hours.
   - **Solution**: The firmware executes a **tare calibration** during `setup()` by averaging 10 readings of `bme.readAltitude(1013.25)`.
   - Telemetry computes relative elevation as:
     $$\Delta \text{Elev} = \text{Altitude}_{\text{current}} - \text{Altitude}_{\text{baseline}}$$
2. **Synthetic Dead-Reckoning Grid (`SynX`, `SynY`)**:
   - In field environments where GNSS precision suffers from multipath error or tree canopy cover, the rover tracks row and drop indices using boustrophedon (serpentine) navigation:
     - For odd rows ($Row \pmod 2 \neq 0$): $\text{SynX} = (Drop - 1) \times S_{\text{drop}}$
     - For even rows ($Row \pmod 2 = 0$): $\text{SynX} = (N_{\text{drops}} - Drop) \times S_{\text{drop}}$
     - In both rows: $\text{SynY} = (Row - 1) \times S_{\text{row}}$
3. **Course Error (`Err`)**:
   - Deviation between target furrow heading ($\theta_{\text{target}} \in \{90^\circ, 270^\circ\}$) and absolute magnetometer heading ($\theta_{\text{abs}}$), normalized to $[-180^\circ, +180^\circ]$.

### 2.4 Operational State Machine & Teleoperation Architecture

To support defense demonstrations, testing, and field safety, the rover firmware implements a preemptive three-state hierarchical state machine:

```mermaid
stateDiagram-v2
    [*] --> BOOT : Power On / Reset
    BOOT --> AUTO_MISSION : Calibration Complete & Wi-Fi Connected

    state AUTO_MISSION {
        [*] --> Traversal
        Traversal --> DropCycle : Waypoint Reached
        DropCycle --> Traversal : Planting Complete
    }

    state MANUAL_OVERRIDE {
        [*] --> IdleStandby
        IdleStandby --> DirectionalNudge : WASD / Arrow Command
        DirectionalNudge --> IdleStandby : Deadman Timeout (600ms)
        IdleStandby --> ActuatorTest : Seed / Water / Arm Pulse
        ActuatorTest --> IdleStandby
    }

    state EMERGENCY_STOP {
        [*] --> ZeroPowerKill : 0% PWM, Pump Cut, Alarm
    }

    AUTO_MISSION --> MANUAL_OVERRIDE : Any Operator Nudge / Actuator Test
    MANUAL_OVERRIDE --> AUTO_MISSION : Operator "Resume Auto" Command

    AUTO_MISSION --> EMERGENCY_STOP : Remote E-Stop / Obstacle / Voltage Failsafe
    MANUAL_OVERRIDE --> EMERGENCY_STOP : Remote E-Stop / Obstacle / Voltage Failsafe
    EMERGENCY_STOP --> MANUAL_OVERRIDE : Operator "Clear E-Stop"
```

#### Key Capabilities:
1. **Testing & Defense Demo Mode**:
   - Allows operator to drive the rover to a furrow starting point without triggering an autonomous planting cycle.
   - Independent actuator test bench: single seed kernel drop (Hopper Servo D10), single water micro-dose 400ms pulse (Relay D7), articulated arm toggle (Servo D12).
2. **Safety & Remote E-Stop**:
   - Preempts all states immediately. Forces motor PWM to 0, cuts pump power, activates continuous horn tone and flashing red NeoPixels.
   - Global E-Stop trigger accessible in header navigation bar across the entire web workstation.
3. **Dual Transport Channels**:
   - **Local Subnet (Port 8080)**: Direct HTTP GET commands (`http://<rover-ip>:8080/cmd?action=...`) with $<20\text{ ms}$ latency when connected to local farm Wi-Fi or mobile hotspot.
   - **Cloud Relay (Dokploy)**: Transparent fallback via `POST /api/command` on the Dokploy API when operator and rover are on separate network subnets.
4. **Deadman Safety Timeout**:
   - In `MANUAL_OVERRIDE`, motors automatically stop if no directional command is received within **600ms**, preventing rover runaway on lost Wi-Fi packets.

---

## 3. Telemetry Protocol Specification

The rover streams and persists records in an exact 19-column CSV format (and identical JSON payload keys):

```csv
Row,Drop,SynX,SynY,Volt,TempC,Hum,Press,Elev,Moist,Watered,AbsHead,Err,Pitch,Roll,Lat,Lng,Sats,ObsDist
```

### 3.1 Field Dictionary

| Column | JSON Key | Type | Unit | Range | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Row** | `row` | Integer | - | $1 \dots \infty$ | Furrow index across the agricultural plot |
| **Drop** | `drop` | Integer | - | $1 \dots N$ | Planted seed index within the active furrow |
| **SynX** | `synX` | Float | m | $0.00 \dots X_{\max}$ | Local orthogonal Cartesian X-coordinate |
| **SynY** | `synY` | Float | m | $0.00 \dots Y_{\max}$ | Local orthogonal Cartesian Y-coordinate |
| **Volt** | `volt` | Float | V | $0.00 \dots 14.80$ | Rover power bus battery voltage |
| **TempC** | `tempC` | Float | °C | $-10.0 \dots 65.0$ | Ambient canopy temperature |
| **Hum** | `hum` | Float | % | $0.0 \dots 100.0$ | Ambient relative humidity |
| **Press** | `press` | Float | hPa | $800.0 \dots 1100.0$| Barometric atmospheric pressure |
| **Elev** | `elev` | Float | m | $-50.0 \dots 50.0$ | Relative micro-topography ground elevation |
| **Moist** | `moist` | Integer | raw | $0 \dots 1023$ | Volumetric soil moisture sensor reading |
| **Watered**| `watered`| Boolean| flag | $0 \text{ or } 1$ | Whether localized irrigation dose was dispensed |
| **AbsHead**| `absHead`| Float | deg | $0.0 \dots 359.9$ | True magnetic compass azimuth |
| **Err** | `err` | Float | deg | $-180.0 \dots 180.0$| Heading error offset relative to furrow track |
| **Pitch** | `pitch` | Float | deg | $-90.0 \dots 90.0$ | Longitudinal rover inclination (fore/aft slope) |
| **Roll** | `roll` | Float | deg | $-90.0 \dots 90.0$ | Transverse rover inclination (port/starboard slope) |
| **Lat** | `lat` | Float | deg | $-90.0 \dots 90.0$ | WGS84 GPS Latitude |
| **Lng** | `lng` | Float | deg | $-180.0 \dots 180.0$| WGS84 GPS Longitude |
| **Sats** | `sats` | Integer | count| $0 \dots 32$ | Visible and locked GNSS satellite count |
| **ObsDist**| `obsDist`| Float | cm | $0.0 \dots 999.0$ | Forward clearance to nearest obstacle |

---

## 4. Cloud Ingestion & Backend Architecture (Dokploy)

The cloud tier is designed for deployment on **Dokploy** (Docker container PaaS) using Docker Compose.

### 4.1 Production Database Infrastructure
- **DBMS**: PostgreSQL 18.6 (Debian 18.6)
- **Host**: `178.105.184.157:6000`
- **Database**: `rover-hub`
- **User**: `rovadmin`
- **Connection URI**: `postgresql://rovadmin:S7ISb9PGLYnWzbB43fnu@178.105.184.157:6000/rover-hub`
- **Current Status**: Live and active; schema (`missions`, `telemetry_points`) migrated.

```mermaid
flowchart LR
    subgraph DokployHost["Dokploy Host (Docker Network)"]
        API["rover-api (Node.js 20)\nPort: 3001"]
    end
    subgraph RemoteDB["Remote Database Host (178.105.184.157:6000)"]
        PG[("PostgreSQL 18.6\n(rover-hub)")]
    end

    API -->|DATABASE_URL| PG
    Internet(("Public / Rover Traffic")) -->|HTTP POST /api/telemetry| API
```

### 4.2 Relational Database Schema (PostgreSQL)

```sql
-- Missions Table: High-level mission run metadata
CREATE TABLE missions (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    config_id VARCHAR(64),
    field_id VARCHAR(64),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Telemetry Points Table: Time-series drop observations
CREATE TABLE telemetry_points (
    id BIGSERIAL PRIMARY KEY,
    mission_id VARCHAR(64) REFERENCES missions(id) ON DELETE CASCADE,
    row_num INT NOT NULL,
    drop_num INT NOT NULL,
    syn_x FLOAT NOT NULL,
    syn_y FLOAT NOT NULL,
    volt FLOAT,
    temp_c FLOAT,
    hum FLOAT,
    press FLOAT,
    elev FLOAT,
    moist INT,
    watered BOOLEAN DEFAULT false,
    abs_head FLOAT,
    err FLOAT,
    pitch FLOAT,
    roll FLOAT,
    lat FLOAT,
    lng FLOAT,
    sats INT DEFAULT 0,
    obs_dist FLOAT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_telemetry_mission ON telemetry_points(mission_id);
CREATE INDEX idx_telemetry_row_drop ON telemetry_points(mission_id, row_num, drop_num);
```

### 4.3 REST API Endpoints

- `GET /api/health`: Health probe and service version verification for Dokploy automated monitoring.
- `GET /api/missions`: Returns list of all missions with aggregated telemetry point counts.
- `GET /api/missions/:id`: Returns full mission entity including all ordered telemetry points.
- `POST /api/missions`: Bulk ingest of completed mission run.
- `POST /api/telemetry`: Streaming endpoint receiving single-drop telemetry from Arduino Uno R4 WiFi.

---

## 5. Frontend Workstation Architecture (Web Application)

### 5.1 Tech Stack & Design Principles
- **Core Framework**: React 19, TypeScript, Vite.
- **Client Storage**: Dexie.js (IndexedDB wrapper) enabling offline-first field operation without mandatory internet access.
- **3D Visualization**: Three.js WebGL rendering with custom procedural terrain geometry, elevation heatmap vertex coloring, and animated rover mesh traversal.
- **Data Analytics**: Plotly.js for multi-series correlation (Soil Moisture vs Irrigation, Battery Voltage curves, Heading Error distributions).
- **UI Design System**: Tailwind CSS v4, Lucide SVG icons, zero-emoji professional engineering workstation standard, responsive drawer navigation.

### 5.2 3D Terrain Reconstruction Engine (`Terrain3D.tsx`)
1. **Grid Generation**: Calculates bounding box from $(\text{SynX}, \text{SynY})$ or translated GPS coordinates.
2. **Elevation Warping**: Maps barometric relative elevation (`Elev`) to surface vertex heights using inverse-distance weighting (IDW) interpolation.
3. **Agronomic Heatmap**: Vertex shader interpolates between deep green (low elevation/furrow bottoms) to sandy yellow and reddish-brown (high terrain ridges).
4. **Kinematic Playback**: Smooth spherical linear interpolation (`slerp`) of rover orientation, pitching and rolling according to real MPU-6050 telemetry data points.

---

## 6. End-to-End Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant R as Arduino Rover (Uno R4 WiFi)
    participant S as Dokploy Server (PostgreSQL 18.6)
    participant W as Web App (Mission Manager)

    Note over R: Setup: BME280 baseline tare calibration & Wi-Fi connect
    loop Every Planting Drop
        R->>R: Read BME280, MPU-6050, Compass, GPS, Moisture
        R->>R: Calculate synX, synY, relative elev
        R->>R: Actuate seed hopper servo & water pump
        R->>R: Output CSV line to USB CDC Serial (115200 Baud)
        R->>S: HTTP POST /api/telemetry (JSON payload)
        S->>S: Insert row into PostgreSQL telemetry_points
    end

    opt Real-Time Web Monitoring & Cloud Sync
        W->>S: GET /api/missions (via Dokploy Sync)
        S-->>W: Return mission run & telemetry points
        W->>W: Upsert into IndexedDB (Dexie)
        W->>W: Render 3D Terrain Digital Twin, Path Playback & Analytics
    end
```

---

## 7. Claude Prompting Cheat-Sheet (Architecture Documentation Generator)

To generate complete architectural documentation, specifications, or academic reports with Claude, use the following system prompt and input context:

### Prompt Template for Claude:
```text
You are an expert Autonomous Robotics & Precision Agriculture Systems Architect.
Using the provided "Autonomous Maize Rover System: Architecture Knowledge Base", complete the detailed system architecture documentation.

Follow these strict guidelines:
1. Preserve the 19-column telemetry specification without omitting any column.
2. Explain the hardware limitations of the Arduino Uno R4 (8KB Data Flash vs 32KB volatile SRAM) and justify the dual MicroSD + Wi-Fi architecture.
3. Detail the BME280 tare baseline calibration formula for relative micro-elevation.
4. Provide the exact Docker Compose and PostgreSQL relational schema for the Dokploy deployment.
5. Emphasize the offline-first IndexedDB (Dexie) design pattern of the Three.js 3D web workstation.
6. Maintain an academic, professional engineering tone with clean ASCII or Mermaid diagrams and no emojis.
```
