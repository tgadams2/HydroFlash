"""The HydroFLASH Irrigation integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import HydroFlashClient
from .coordinator import HydroFlashCoordinator

PLATFORMS: list[Platform] = [Platform.SWITCH, Platform.SENSOR]

type HydroFlashConfigEntry = ConfigEntry[HydroFlashCoordinator]


async def async_setup_entry(
    hass: HomeAssistant, entry: HydroFlashConfigEntry
) -> bool:
    """Set up HydroFLASH from a config entry."""
    client = HydroFlashClient(
        async_get_clientsession(hass),
        entry.data[CONF_HOST],
        entry.data[CONF_USERNAME],
        entry.data[CONF_PASSWORD],
    )
    coordinator = HydroFlashCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: HydroFlashConfigEntry
) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_reload(hass: HomeAssistant, entry: HydroFlashConfigEntry) -> None:
    """Reload when options (e.g. default run time) change."""
    await hass.config_entries.async_reload(entry.entry_id)
