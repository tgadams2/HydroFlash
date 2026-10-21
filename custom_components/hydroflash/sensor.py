"""Sensor platform: what is watering now, plus controller status (diagnostic)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
)
from homeassistant.const import EntityCategory, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import HydroFlashConfigEntry
from .api import ControllerData
from .coordinator import HydroFlashCoordinator
from .entity import HydroFlashEntity


@dataclass(frozen=True, kw_only=True)
class HydroFlashSensorDescription(SensorEntityDescription):
    """Describes a status sensor and how to read it from a snapshot."""

    value_fn: Callable[[ControllerData], str | int | None]
    diagnostic: bool = True


def _running(data: ControllerData):
    """The station watering now (lowest number if the controller lists several)."""
    return data.active[min(data.active)] if data.active else None


def _zone_label(data: ControllerData) -> str:
    a = _running(data)
    if not a:
        return "Idle"
    station = data.stations.get(a.number)
    return f"{a.number:02d} · {station.name if station else a.name}"


def _program_label(data: ControllerData) -> str:
    a = _running(data)
    if not a:
        return "Idle"
    if a.mode.lower() == "program":
        return f"Program {a.program}" if a.program else "Program"
    return "Manual"


SENSORS: tuple[HydroFlashSensorDescription, ...] = (
    HydroFlashSensorDescription(
        key="running_zone",
        translation_key="running_zone",
        icon="mdi:sprinkler-variant",
        diagnostic=False,
        value_fn=_zone_label,
    ),
    HydroFlashSensorDescription(
        key="running_program",
        translation_key="running_program",
        icon="mdi:calendar-clock",
        diagnostic=False,
        value_fn=_program_label,
    ),
    HydroFlashSensorDescription(
        key="time_remaining",
        translation_key="time_remaining",
        icon="mdi:timer-sand",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.MINUTES,
        suggested_display_precision=0,
        diagnostic=False,
        value_fn=lambda data: _running(data).remaining_seconds if data.active else 0,
    ),
    HydroFlashSensorDescription(
        key="rain_delay",
        translation_key="rain_delay",
        icon="mdi:weather-rainy",
        value_fn=lambda data: data.status.get("rain_delay"),
    ),
    HydroFlashSensorDescription(
        key="cloud",
        translation_key="cloud",
        icon="mdi:cloud-outline",
        value_fn=lambda data: data.status.get("cloud"),
    ),
    HydroFlashSensorDescription(
        key="uptime",
        translation_key="uptime",
        icon="mdi:timer-outline",
        entity_registry_enabled_default=False,
        value_fn=lambda data: data.status.get("uptime"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HydroFlashConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    async_add_entities(
        HydroFlashSensor(coordinator, description) for description in SENSORS
    )


class HydroFlashSensor(HydroFlashEntity, SensorEntity):
    """A controller status value."""

    entity_description: HydroFlashSensorDescription

    def __init__(
        self,
        coordinator: HydroFlashCoordinator,
        description: HydroFlashSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        if description.diagnostic:
            self._attr_entity_category = EntityCategory.DIAGNOSTIC
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{description.key}"

    @property
    def native_value(self) -> str | int | None:
        return self.entity_description.value_fn(self.coordinator.data)
