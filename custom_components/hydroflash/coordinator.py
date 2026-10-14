"""Data update coordinator for HydroFLASH."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import AuthError, ControllerData, HydroFlashClient, HydroFlashError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


class HydroFlashCoordinator(DataUpdateCoordinator[ControllerData]):
    """Polls the controller and shares one snapshot with every entity."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: HydroFlashClient,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )
        self.entry = entry
        self.client = client

    async def _async_update_data(self) -> ControllerData:
        try:
            stations = await self.client.async_get_stations()
            status = await self.client.async_get_status()
        except AuthError as err:
            raise UpdateFailed(f"Authentication failed: {err}") from err
        except HydroFlashError as err:
            raise UpdateFailed(f"Error talking to controller: {err}") from err
        return ControllerData(stations=stations, status=status)
