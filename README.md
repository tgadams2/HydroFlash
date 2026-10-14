# HydroFLASH for Home Assistant

[![hacs](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)

Control a **HydroFLASH** sprinkler controller (Digi ConnectMe / NET+OS, Allegro
RomPager web server) from Home Assistant. The controller has no REST/JSON API,
so this integration drives the same HTML forms its built-in web UI uses and
parses the pages back for state.

> The repository also contains a small standalone Node.js dashboard/proxy in
> [`server.js`](server.js) + [`public/`](public); the Home Assistant
> integration is independent of it and lives in
> [`custom_components/hydroflash/`](custom_components/hydroflash).

## Features

- **One switch per station/zone**, auto-discovered with the controller's own
  names (e.g. *Front Lawn-Center*). On → run for the default time; off → stop.
- **Watering-program buttons** — Start Program 1–4, Cancel Program, Skip Station.
- **`hydroflash.run_for` service** to run a zone for a specific number of minutes:
  ```yaml
  service: hydroflash.run_for
  target:
    entity_id: switch.front_lawn_center
  data:
    minutes: 20
  ```
- **Diagnostic sensors**: rain delay, cloud-connection status, controller uptime.
- Each switch exposes `remaining_seconds` and `running_from_program` attributes.

## Installation

### HACS (custom repository)

1. In Home Assistant go to **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/tgadams2/HydroFlash` with category **Integration**.
3. Download **HydroFLASH Irrigation**, then **restart Home Assistant**.
4. **Settings → Devices & Services → Add Integration → HydroFLASH Irrigation.**

### Manual

Copy `custom_components/hydroflash/` into your Home Assistant
`config/custom_components/` directory and restart.

## Configuration

Enter the controller's IP address, username (`root` is the default for all
HydroFLASH units), and the web password. The default manual run time is set
under the integration's **Configure** option.

## Notes

- Local polling every 30 s; the controller is a slow embedded box, so traffic
  is kept light and stations run one at a time (as the hardware does).
- HTTP only (the device's HTTPS is not reachable). Keep it on a trusted LAN.
- Tested against application build *Jun 8 2020*, NET+OS 7.5.2.2.

## Disclaimer

Not affiliated with or endorsed by HydroFLASH. Use at your own risk; this talks
to an out-of-support controller over its local web interface.
