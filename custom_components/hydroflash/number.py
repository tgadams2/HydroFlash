"""Number platform: editable per-zone manual run time.

The controller does not store a per-zone manual duration, so this value lives
in Home Assistant. It defaults to the integration's configured default run
time and is used by the matching zone switch when it is turned on.
"""

from __future__ import annotations

from homeassistant.components.number import NumberMode, RestoreNumber
from homeassistant.const import EntityCategory, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import HydroFlashConfigEntry
from .coordinator import HydroFlashCoordinator
from .entity import HydroFlashEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HydroFlashConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    async_add_entities(
        HydroFlashRunTimeNumber(coordinator, number)
        for number in sorted(coordinator.data.stations)
    )


class HydroFlashRunTimeNumber(HydroFlashEntity, RestoreNumber):
    """The manual run time (minutes) for one zone."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_native_min_value = 1
    _attr_native_max_value = 599
    _attr_native_step = 1
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_mode = NumberMode.BOX
    _attr_icon = "mdi:timer-cog-outline"

    def __init__(self, coordinator: HydroFlashCoordinator, number: int) -> None:
        super().__init__(coordinator)
        self._number = number
        self._attr_unique_id = f"{coordinator.entry.entry_id}_run_time_{number}"

    @property
    def _station(self):
        return self.coordinator.data.stations.get(self._number)

    @property
    def name(self) -> str:
        station = self._station
        label = station.name if station else f"Station {self._number}"
        return f"{self._number:02d} · {label} run time"

    @property
    def native_value(self) -> float:
        return self.coordinator.minutes_for(self._number)

    async def async_set_native_value(self, value: float) -> None:
        self.coordinator.run_minutes[self._number] = int(value)
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        """Restore the last set value across restarts."""
        await super().async_added_to_hass()
        last = await self.async_get_last_number_data()
        if last is not None and last.native_value is not None:
            self.coordinator.run_minutes[self._number] = int(last.native_value)
