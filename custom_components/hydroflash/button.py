"""Button platform: manual control of watering programs.

The controller exposes program control as stateless actions (start / cancel /
skip) and does not report which program is running, so these are modelled as
buttons rather than switches.
"""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import HydroFlashConfigEntry
from .api import PROGRAM_COUNT
from .coordinator import HydroFlashCoordinator
from .entity import HydroFlashEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HydroFlashConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    entities: list[ButtonEntity] = [
        StartProgramButton(coordinator, program)
        for program in range(1, PROGRAM_COUNT + 1)
    ]
    entities.append(CancelProgramButton(coordinator))
    entities.append(SkipStationButton(coordinator))
    async_add_entities(entities)


class StartProgramButton(HydroFlashEntity, ButtonEntity):
    """Starts a specific watering program."""

    _attr_icon = "mdi:play-circle-outline"
    _attr_translation_key = "start_program"

    def __init__(self, coordinator: HydroFlashCoordinator, program: int) -> None:
        super().__init__(coordinator)
        self._program = program
        self._attr_translation_placeholders = {"program": str(program)}
        self._attr_unique_id = (
            f"{coordinator.entry.entry_id}_start_program_{program}"
        )

    async def async_press(self) -> None:
        await self.coordinator.client.async_start_program(self._program)
        await self.coordinator.async_request_refresh()


class CancelProgramButton(HydroFlashEntity, ButtonEntity):
    """Cancels the currently running watering program."""

    _attr_icon = "mdi:stop-circle-outline"
    _attr_translation_key = "cancel_program"

    def __init__(self, coordinator: HydroFlashCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.entry.entry_id}_cancel_program"

    @property
    def extra_state_attributes(self) -> dict[str, bool]:
        return {"program_running": self.coordinator.data.program_running}

    async def async_press(self) -> None:
        # The controller cancels the active program regardless of the number;
        # program 1 is a safe placeholder for the form field.
        await self.coordinator.client.async_cancel_program(1)
        await self.coordinator.async_request_refresh()


class SkipStationButton(HydroFlashEntity, ButtonEntity):
    """Advances the running program to its next station."""

    _attr_icon = "mdi:skip-next-circle-outline"
    _attr_translation_key = "skip_station"
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: HydroFlashCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.entry.entry_id}_skip_station"

    async def async_press(self) -> None:
        await self.coordinator.client.async_skip_station(1)
        await self.coordinator.async_request_refresh()
