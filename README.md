# Rover Mission Manager

Professional web application for managing autonomous rover missions - planning, configuration, and telemetry analysis.

## Features

- **Dashboard** - Overview of missions, configs, and fields
- **Mission Planner** - Configure mission parameters with live path preview
- **Mission Library** - Upload and manage completed telemetry CSVs
- **Field Management** - Organize missions by field/location
- **Analytics** - (Coming soon) Mission comparison and performance metrics

## Tech Stack

- React 18 + TypeScript
- Vite (fast build tool)
- React Router (multi-page navigation)
- Tailwind CSS (clean, minimal styling)
- Dexie.js (IndexedDB for local storage)

## Getting Started

### Install dependencies:
```bash
cd rover-mission-manager
npm install
```

### Run locally:
```bash
npm run dev
```

App will be available at: **http://localhost:5173/**

### Build for production:
```bash
npm run build
npm run preview
```

## Usage

### 1. Mission Planning
1. Go to **Mission Planner**
2. Configure parameters (rows, drops, spacing, PID values)
3. Preview the boustrophedon path
4. Save configuration
5. Export Arduino code to flash to rover

### 2. Upload Telemetry
1. Complete mission on rover (saves CSV)
2. Download CSV wirelessly from rover
3. Go to **Library** → Upload CSV
4. View mission data and telemetry

### 3. Field Management
1. Create fields with name, location, area
2. Associate missions with specific fields
3. Organize by location/season

## CSV Format

The app supports both current (13 columns) and future (14 columns with elevation) formats:

**Current:**
```
Row,Drop,SynX_cm,SynY_cm,GpsLat,GpsLng,Moisture,Watered,AbsHead,HeadErr,Pitch,Roll,Sats
```

**With Elevation (BME280):**
```
Row,Drop,SynX_cm,SynY_cm,GpsLat,GpsLng,Moisture,Watered,AbsHead,HeadErr,Pitch,Roll,Elev_m,Sats
```

## Data Storage

All data is stored locally in your browser using IndexedDB:
- Mission configurations
- Completed runs
- Field information
- No server or cloud required

## Upcoming Features

- 3D terrain visualization with Plotly
- Multi-mission comparison
- Performance metrics dashboard
- Mission templates
- PDF report export
- Advanced analytics

## Performance

- Optimized for all computers
- Lazy loading for heavy components
- Efficient rendering
- Works offline after first load
