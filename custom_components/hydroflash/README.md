# HydroFLASH Irrigation — Home Assistant integration

Control a HydroFLASH sprinkler controller (Digi ConnectMe / NET+OS, Allegro
RomPager web server) from Home Assistant. The controller has no REST/JSON API,
so this integration drives the same HTML forms its built-in web UI uses and
parses the pages back for state.

## Features

- **One switch per station/zone**, auto-discovered with the controller's own
  zone names (e.g. *Front Lawn-Center*).
  - Turn **on** → runs the zone for the configured default time (default 20 min).
  - Turn **off** → stops the running zone.
- **`hydroflash.run_for` service** to run a specific zone for a chosen number of
  minutes:
  ```yaml
  service: hydroflash.run_for
  target:
    entity_id: switch.front_lawn_center
  data:
    minutes: 20
  ```
- **Diagnostic sensors**: rain delay, cloud-connection status, controller uptime.
- Each switch exposes `remaining_seconds` and `running_from_program` attributes.

## Install

1. Copy `custom_components/hydroflash/` into your Home Assistant `config/custom_components/`
   directory (or add this repo to HACS as a custom repository).
2. Restart Home Assistant.
3. **Settings → Devices & Services → Add Integration → HydroFLASH Irrigation.**
4. Enter the controller's IP, username (usually `root`), and web password.
5. Optionally set the default manual run time under the integration's **Configure**.

## Notes

- Local polling every 30 s; the controller is a slow embedded box, so the
  integration keeps traffic light and runs one station at a time (as the
  hardware does).
- HTTP only (the device's HTTPS is not reachable). Keep it on a trusted LAN.
- Tested against application build *Jun 8 2020*, NET+OS 7.5.2.2.
