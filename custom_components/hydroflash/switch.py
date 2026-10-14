"""Switch platform: one switch per irrigation station."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components.switch import SwitchDeviceClass, SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, entity_platform
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import HydroFlashConfigEntry
from .const import ATTR_MINUTES, SERVICE_RUN_FOR
from .coordinator import HydroFlashCoordinator
from .entity import HydroFlashEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HydroFlashConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create a switch for every station the controller reports."""
    coordinator = entry.runtime_data
    async_add_entities(
        HydroFlashStationSwitch(coordinator, number)
        for number in sorted(coordinator.data.stations)
    )

    platform = entity_platform.async_get_current_platform()
    platform.async_register_entity_service(
        SERVICE_RUN_FOR,
        {vol.Required(ATTR_MINUTES): vol.All(cv.positive_int, vol.Range(min=1, max=599))},
        "async_run_for",
    )


class HydroFlashStationSwitch(HydroFlashEntity, SwitchEntity):
    """A single station. On = run for the default time; off = stop."""

    _attr_device_class = SwitchDeviceClass.SWITCH
    _attr_icon = "mdi:sprinkler"

    def __init__(self, coordinator: HydroFlashCoordinator, number: int) -> None:
        super().__init__(coordinator)
        self._number = number
        self._attr_unique_id = f"{coordinator.entry.entry_id}_station_{number}"
        self._attr_translation_placeholders = {"number": str(number)}

    @property
    def _station(self):
        return self.coordinator.data.stations.get(self._number)

    @property
    def available(self) -> bool:
        return super().available and self._station is not None

    @property
    def name(self) -> str | None:
        station = self._station
        label = station.name if station else f"Station {self._number}"
        # Zero-pad so the zones sort numerically (e.g. 02 before 10).
        return f"{self._number:02d} · {label}"

    @property
    def is_on(self) -> bool:
        station = self._station
        return bool(station and station.is_on)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        station = self._station
        if not station:
            return {}
        return {
            "station_number": station.number,
            "remaining_seconds": station.remaining_seconds,
            "running_from_program": station.program_on,
        }

    async def async_turn_on(self, **kwargs: Any) -> None:
        # Use this zone's editable run time (falls back to the default).
        await self.async_run_for(self.coordinator.minutes_for(self._number))

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.client.async_stop_station(self._number)
        await self.coordinator.async_request_refresh()

    async def async_run_for(self, minutes: int) -> None:
        """Run this station for a specific number of minutes."""
        await self.coordinator.client.async_start_station(
            self._number, minutes // 60, minutes % 60
        )
        await self.coordinator.async_request_refresh()
