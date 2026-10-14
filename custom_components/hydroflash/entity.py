"""Shared base entity for HydroFLASH."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import HydroFlashCoordinator


class HydroFlashEntity(CoordinatorEntity[HydroFlashCoordinator]):
    """Common device info / attribution for all HydroFLASH entities."""

    _attr_has_entity_name = True
    _attr_attribution = "Data from HydroFLASH controller"

    def __init__(self, coordinator: HydroFlashCoordinator) -> None:
        super().__init__(coordinator)
        host = coordinator.entry.data["host"]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.entry.entry_id)},
            name="HydroFLASH Irrigation",
            manufacturer="HydroFLASH",
            model="Digi ConnectMe (NET+OS)",
            configuration_url=f"http://{host}/",
        )
