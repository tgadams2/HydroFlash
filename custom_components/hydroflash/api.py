"""Client for the HydroFLASH irrigation controller.

The controller is a Digi ConnectMe (NET+OS 7.5.2.2) running an Allegro
RomPager web server. It has no JSON/REST API; control happens through the
same HTML forms the built-in web UI posts, and state is read back by
parsing those pages. The parsing here is deliberately tolerant of the
quirky, whitespace-heavy markup the device emits.

Verified endpoints:
  GET  /FS/RAM0/status.xml          -> system status (rain delay, uptime, ...)
  POST /manual_control.htm          -> station table (name / state / remaining)
  POST /Forms/update_man.htm        -> start or stop a station
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import aiohttp

STATUS_PATH = "/FS/RAM0/status.xml"
MANUAL_PATH = "/manual_control.htm"
MANUAL_FORM = "/Forms/update_man.htm"
PROGRAM_FORM = "/Forms/manual_program_ctl.htm"

# Watering programs the controller exposes (Program 1..4).
PROGRAM_COUNT = 4

# Collapses the whitespace the device sprinkles between tags so the row
# patterns below can stay simple.
_WS_BETWEEN_TAGS = re.compile(r">\s+<")
_ROW_SPLIT = re.compile(r'(?=<td class="STATIONS"><center><b>)')
_NUM = re.compile(r"<b>\s*(\d+)\s*</b>")
_NAME = re.compile(r"</td><td><b>\s*(.*?)(?:&nbsp)?</b>", re.DOTALL)
_RUNTIME = re.compile(r'VALUE="(\d+)"')
_STATE = re.compile(r"<B>(ON|OFF)</B>", re.IGNORECASE)
_BTN = re.compile(r'VALUE="(Turn ON|Turn OFF)"', re.IGNORECASE)


@dataclass
class Station:
    """One irrigation station (zone)."""

    number: int
    name: str
    is_on: bool
    program_on: bool
    remaining_seconds: int


@dataclass
class ControllerData:
    """A snapshot of everything the coordinator polls."""

    stations: dict[int, Station] = field(default_factory=dict)
    status: dict[str, str] = field(default_factory=dict)

    @property
    def program_running(self) -> bool:
        """True if any station is currently being watered by a program.

        The controller does not report which program is active, only that a
        program is driving some station, so this is a single global flag.
        """
        return any(station.program_on for station in self.stations.values())


class HydroFlashError(Exception):
    """Raised when the controller cannot be reached or understood."""


class AuthError(HydroFlashError):
    """Raised when the controller rejects the credentials."""


def _tag(xml: str, tag: str) -> str:
    """Pull the text of <TAG>...</TAG, tolerating the device's stray newlines."""
    m = re.search(rf"<{tag}>(.*?)</{tag}", xml, re.DOTALL | re.IGNORECASE)
    return m.group(1).strip() if m else ""


class HydroFlashClient:
    """Minimal async client around the controller's web UI."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        host: str,
        username: str,
        password: str,
    ) -> None:
        self._session = session
        self._base = f"http://{host}"
        self._auth = aiohttp.BasicAuth(username, password)

    async def _request(
        self, method: str, path: str, data: dict | None = None
    ) -> str:
        try:
            async with self._session.request(
                method,
                self._base + path,
                data=data,
                auth=self._auth,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as resp:
                if resp.status in (401, 403):
                    raise AuthError("Controller rejected credentials")
                resp.raise_for_status()
                return await resp.text()
        except aiohttp.ClientResponseError as err:
            if err.status in (401, 403):
                raise AuthError("Controller rejected credentials") from err
            raise HydroFlashError(str(err)) from err
        except (aiohttp.ClientError, TimeoutError) as err:
            raise HydroFlashError(str(err)) from err

    async def async_get_status(self) -> dict[str, str]:
        """Read /status.xml into a flat dict."""
        xml = await self._request("GET", STATUS_PATH)
        cloud = _tag(xml, "CLOUDSTAT")
        return {
            "date": _tag(xml, "DATE"),
            "sun": _tag(xml, "SUNDATA"),
            "cloud": cloud,
            "cloud_connected": cloud.endswith("Connected")
            and "Disconnected" not in cloud,
            "uptime": _tag(xml, "CPUTIME"),
            "rain_delay": _tag(xml, "RAINDELAY"),
        }

    async def async_get_stations(self) -> dict[int, Station]:
        """Parse the manual-control page into Station objects.

        The page is only served to POST requests (a bare GET returns a
        "Protected Object" stub), so we POST an empty body to read it.
        """
        html = await self._request("POST", MANUAL_PATH, data=b"")
        html = _WS_BETWEEN_TAGS.sub("><", html)
        stations: dict[int, Station] = {}
        for chunk in _ROW_SPLIT.split(html)[1:]:
            num = _NUM.search(chunk)
            if not num:
                continue
            states = _STATE.findall(chunk)
            runtime = _RUNTIME.findall(chunk)
            name = _NAME.search(chunk)
            number = int(num.group(1))
            hrs = int(runtime[0]) if len(runtime) >= 1 else 0
            mins = int(runtime[1]) if len(runtime) >= 2 else 0
            stations[number] = Station(
                number=number,
                name=(name.group(1).strip() if name else f"Station {number}"),
                is_on=bool(states) and states[0].upper() == "ON",
                program_on=len(states) > 1 and states[1].upper() == "ON",
                remaining_seconds=(hrs * 3600 + mins * 60),
            )
        if not stations:
            raise HydroFlashError("No stations found on manual-control page")
        return stations

    async def async_start_station(
        self, number: int, hours: int, minutes: int
    ) -> None:
        """Turn a station on for the given run time."""
        await self._request(
            "POST",
            MANUAL_FORM,
            data={
                f"ManRunTimeHrs?{number}": str(hours),
                f"ManRunTimeMin?{number}": f"{minutes:02d}",
                "Submit": "Turn ON",
            },
        )

    async def async_stop_station(self, number: int) -> None:
        """Turn a station off. The controller runs one station at a time."""
        await self._request(
            "POST",
            MANUAL_FORM,
            data={
                f"ManRunTimeHrs?{number}": "0",
                f"ManRunTimeMin?{number}": "00",
                "Submit": "Turn OFF",
            },
        )

    async def _program_action(self, program: int, action: str) -> None:
        """POST a manual-program-control action for Program `program` (1-based)."""
        await self._request(
            "POST",
            PROGRAM_FORM,
            data={
                # The controller numbers programs from 0 as an 8-digit value.
                "ProgramNumValueSingle": f"{program - 1:08d}",
                "Submit": action,
            },
        )

    async def async_start_program(self, program: int) -> None:
        """Manually start a watering program (1-based)."""
        await self._program_action(program, "Start Program")

    async def async_cancel_program(self, program: int) -> None:
        """Cancel the running watering program."""
        await self._program_action(program, "Cancel Program")

    async def async_skip_station(self, program: int) -> None:
        """Advance the running program to its next station."""
        await self._program_action(program, "Skip Station")
