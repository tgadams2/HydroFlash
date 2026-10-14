"""Constants for the HydroFLASH integration."""

from __future__ import annotations

DOMAIN = "hydroflash"

CONF_DEFAULT_MINUTES = "default_minutes"

# The controller is a slow embedded box; don't hammer it.
DEFAULT_SCAN_INTERVAL = 30
DEFAULT_RUN_MINUTES = 20

# The controller supports a fixed number of stations.
MAX_STATIONS = 16

# Entity service exposed on station switches.
SERVICE_RUN_FOR = "run_for"
ATTR_MINUTES = "minutes"
