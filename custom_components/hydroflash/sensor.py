"""Sensor platform: controller-level status (diagnostic)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import HydroFlashConfigEntry
from .api import ControllerData
from .coordinator import HydroFlashCoordinator
from .entity import HydroFlashEntity


@dataclass(frozen=True, kw_only=True)
class HydroFlashSensorDescription(SensorEntityDescription):
    """Describes a status sensor and how to read it from a snapshot."""

    value_fn: Callable[[ControllerData], str | None]


SENSORS: tuple[HydroFlashSensorDescription, ...] = (
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
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        coordinator: HydroFlashCoordinator,
        description: HydroFlashSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{description.key}"

    @property
    def native_value(self) -> str | None:
        return self.entity_description.value_fn(self.coordinator.data)
