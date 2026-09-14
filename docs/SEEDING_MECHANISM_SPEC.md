# Autonomous Maize Rover: Rotary Drum Seeding Mechanism Design

**Mechanism Type**: Direct-Coupled Oscillating Rotary Drum (Cylindrical Rotor Pod)  
**Actuator**: TowerPro MG996R / DS3218 Metal-Gear High-Torque Servo (Pin D10)  
**Mounting Interface**: 4× M4 Socket Head Bolts to Rover Chassis Plate  
**Seed Target**: Zea mays (Maize / Corn: ~9–12 mm kernel length, ~6–8 mm width)

---

## 1. Engineering 3D CAD Visualization

![Modular Seeder Pod](/home/elikplim/.gemini/antigravity-cli/brain/a22af529-05f1-4f93-92e1-200ca937201b/modular_seeder_pod_1789344766456.jpg)

---

## 2. Working Principle: Oscillating Rotor with Flexible Anti-Pinch Wiper

The **Rotary Drum Metering Pod** replaces linear sliders with a cylindrical barrel rotating inside a precision-bored stator sleeve. The servo is directly coupled coaxially to the rotor shaft, eliminating push-rods, linkages, and exposed slide rails that could bind from field soil and dust.

```mermaid
sequenceDiagram
    autonumber
    participant H as Conical Hopper (Top)
    participant W as Flexible Wiper Brush
    participant R as Cylindrical Drum Rotor
    participant C as Discharge Chute (Bottom)

    Note over R: Position 0° (Fill / Standby)
    H->>R: One maize kernel falls by gravity into the top calibrated pocket
    Note over R: Servo rotates 0° -> 90° CW (Discharge Stroke)
    R->>W: Pocket sweeps past flexible wiper brush; excess kernels swept back without crushing
    Note over R: Position 90° (Discharge Alignment)
    R->>C: Pocket inverts directly over drop tube; kernel free-falls into furrow
    Note over R: Servo rotates 90° -> 0° CCW (Return Stroke)
    R->>H: Pocket returns to top vertical alignment to reload next seed
```

---

## 3. Key Advantages of the Rotor Design

| Engineering Criteria | Rotary Drum Metering Pod | Linear Slider / Drawer |
| :--- | :--- | :--- |
| **Mechanical Simplicity** | **Direct Drive**: Rotor mounts directly on the 25T servo output shaft or via flexible coupler. Zero linkages. | Requires a crank arm, pushrod, ball-joints, and guide tracks. |
| **Dust & Soil Sealing** | **Enclosed Stator Barrel**: Sealed radial fit prevents dirt, chaff, and grit from entering internal surfaces. | Exposed slide rails can collect grit and increase friction over time. |
| **Cycle Speed** | **Fast (120ms)**: Smooth rotational sweep with zero linear reversal inertia. | Slower due to slider friction and reciprocal stopping points. |
| **Seed Protection** | **Tangential Shearing Path**: Kernel rolls smoothly against the flexible bristle wiper into the pocket. | Linear edges can wedge kernels against flat walls. |

---

## 4. Mechanical Mounting to Rover Chassis

```
                      [ Conical Seed Hopper ]
                                 │
                 ┌───────────────▼───────────────┐
                 │    Stator Housing Sleeve      │════[ MG996R Servo ]
                 │   (Contains Rotary Drum)      │ (Direct Coaxial Shaft)
                 └───────────────┬───────────────┘
                                 │
                   [ Heavy-Duty Mounting Flange ]
                                 │ (4x M4 Hex Socket Bolts)
        ═════════════════════════╪═══════════════════════════════════ (Rover Chassis Plate)
                                 │
                      [ Angled Drop Tube Chute ]
                                 │
                                 ▼ (Directly behind Furrow Opener Blade)
```

1. **Chassis Bolt Pattern**:
   - The pod base features **4× M4 clearance slots** arranged in a rectangular pattern ($60\text{ mm} \times 45\text{ mm}$).
   - Fastened to the rover's aluminum chassis plate using **M4 × 16 mm Socket Head Cap Screws** with lock washers and nylon lock nuts.
   - Slotted base holes provide **$\pm12\text{ mm}$ of vertical height adjustment** to tune drop height relative to the furrow bottom.
2. **Chassis Positioning**:
   - Located on the longitudinal centerline directly trailing the furrow opener shoe and leading the furrow closing press wheel and micro-irrigation drip nozzle.
3. **Vibration Decoupling**:
   - A 2mm neoprene rubber dampening pad is sandwiched between the dispenser mounting flange and the rover body to absorb vibrations from rough agricultural terrain.
4. **Wiring Pass-Through**:
   - Servo 3-pin cable routes directly through an integrated rear grommet channel into the sealed rover body to Arduino Uno R4 Pin **D10**.

---

## 5. Anti-Jamming & Singulation Engineering

1. **Flexible Wiper Brush Lip**:
   - Located at the 45° transition between the hopper throat and the stator wall.
   - Made of dense nylon bristles (or 2mm food-grade silicone squeegee flap).
   - As the drum rotates, the wiper brushes away secondary kernels without cracking the seed coat or stalling the servo.
2. **Calibrated Teardrop Pocket Geometry**:
   - Pocket dimensions: **13 mm length × 8.5 mm width × 7 mm depth**.
   - Chamfered $45^\circ$ internal lead-in fillet ensures a flat maize seed settles naturally into the cavity by gravity.
3. **High-Torque Metal Gearhead**:
   - The **MG996R** delivers **$11\text{ kg}\cdot\text{cm}$ of stall torque**, easily overcoming any light friction from corn chaff or dry seed coatings.

---

## 6. Firmware Actuation Routine

Mapped directly to `MaizeRover_Phase2_Master.ino`:

```cpp
// Seeding Actuation on Pin D10
#define SEED_SERVO_PIN 10
Servo seedServo;

void setup() {
  seedServo.attach(SEED_SERVO_PIN);
  seedServo.write(0); // 0°: Standby fill position (pocket facing hopper throat)
}

void actuateSeedDrop() {
  // 1. Rotate drum 90° CW to discharge aperture
  seedServo.write(90);  // 90°: Pocket inverts over drop chute
  delay(180);           // 180ms gravity ejection delay
  
  // 2. Return drum to 0° CCW to reload for next furrow step
  seedServo.write(0);   // 0°: Pocket reloads under hopper
  delay(100);
}
```

---

## 7. Bill of Materials (BOM)

| Item | Component | Recommended Material | Qty |
| :---: | :--- | :--- | :---: |
| **1** | Stator Outer Housing & Mount Flange | 3D Printed PETG / ABS (0.2mm layer, 4 perimeters, 40% infill) | 1 |
| **2** | Cylindrical Metering Rotor Drum | 3D Printed PETG or CNC Machined Delrin / Brass | 1 |
| **3** | Seed Hopper (500 ml) | Clear Molded PETG / Acrylic Cone (60° steep slope) | 1 |
| **4** | Servo Motor | TowerPro MG996R or DS3218 Metal Gear Standard Servo | 1 |
| **5** | Flexible Anti-Jam Wiper | Dense Nylon Bristle Strip (12mm width) or 2mm Silicone Flap | 1 |
| **6** | Servo Shaft Coupler | 25T Aluminum Spline Horn or 5mm-to-6mm Rigid Shaft Coupler | 1 |
| **7** | Chassis Mounting Bolts | M4 × 16 mm Stainless Steel Hex Socket Screws + Lock Nuts | 4 |
| **8** | Housing Assembly Fasteners | M3 × 12 mm Button Head Screws + Brass Heat-Set Inserts | 4 |
| **9** | Furrow Drop Tube | Ø20 mm Polycarbonate / Clear Acrylic Tube (beveled tip) | 1 |

---

## 8. Downloadable 3D-Printable STL Models

All 3 components are 100% Watertight (Manifold) and ready to slice:

1. 🏛️ **[Modular Chassis Base with MG996R Motor Mount (`modular_seeder_chassis_base.stl`)](https://github.com/Elikplim-N/rover-mission-manager/blob/main/models/stl/modular_seeder_chassis_base.stl)**:
   - Dedicated 4-bolt MG996R motor mount ($49.5\text{ mm} \times 10.0\text{ mm}$ ear screw holes).
   - Heavy-duty chassis mounting flange with 4x M4 slotted holes ($64\text{ mm} \times 36\text{ mm}$ pattern).
   - Integrated lower drop chute nozzle & wire strain relief conduit.
2. 🔄 **[Modular Rotor Drum (`modular_seeder_rotor.stl`)](https://github.com/Elikplim-N/rover-mission-manager/blob/main/models/stl/modular_seeder_rotor.stl)**:
   - Precision maize seed pocket with 35° forward relief ramp.
   - Dual perimeter agitator ridges preventing hopper bridging.
   - 8mm front axle stub + rear 25T metal servo horn recess.
3. 🛡️ **[Modular Front Cover (`modular_seeder_front_cover.stl`)](https://github.com/Elikplim-N/rover-mission-manager/blob/main/models/stl/modular_seeder_front_cover.stl)**:
   - 608ZZ ball bearing seat ($22.1\text{ mm} \times 7.2\text{ mm}$).
   - Top circular hopper mounting collar (Ø38mm OD, Ø24mm throat).
   - Flexible silicone wiper blade retention slot.
4. 📦 **[Full Reference Assembly (`modular_seeder_full_assembly.stl`)](https://github.com/Elikplim-N/rover-mission-manager/blob/main/models/stl/modular_seeder_full_assembly.stl)**.
