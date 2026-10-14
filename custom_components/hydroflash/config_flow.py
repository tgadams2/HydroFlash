"""Config flow for HydroFLASH."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import AuthError, HydroFlashClient, HydroFlashError
from .const import CONF_DEFAULT_MINUTES, DEFAULT_RUN_MINUTES, DOMAIN

STEP_USER = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
        vol.Required(CONF_USERNAME, default="root"): str,
        vol.Required(CONF_PASSWORD): str,
    }
)


class HydroFlashConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the UI setup flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            await self.async_set_unique_id(user_input[CONF_HOST])
            self._abort_if_unique_id_configured()
            client = HydroFlashClient(
                async_get_clientsession(self.hass),
                user_input[CONF_HOST],
                user_input[CONF_USERNAME],
                user_input[CONF_PASSWORD],
            )
            try:
                await client.async_get_status()
            except AuthError:
                errors["base"] = "invalid_auth"
            except HydroFlashError:
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title=f"HydroFLASH ({user_input[CONF_HOST]})",
                    data=user_input,
                )
        return self.async_show_form(
            step_id="user", data_schema=STEP_USER, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> OptionsFlow:
        return HydroFlashOptionsFlow()


class HydroFlashOptionsFlow(OptionsFlow):
    """Let the user set the default manual run time."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        current = self.config_entry.options.get(
            CONF_DEFAULT_MINUTES, DEFAULT_RUN_MINUTES
        )
        schema = vol.Schema(
            {
                vol.Required(CONF_DEFAULT_MINUTES, default=current): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=599)
                )
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
