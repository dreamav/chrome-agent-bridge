"""
Chrome Agent Bridge - Local FastMCP Server & WebSocket Relay
Zero CPU footprint bridge connecting Google Chrome to AI agents.
"""

import sys
import json
import uuid
import asyncio
import logging
from typing import Any, Dict, List, Optional, Union
import websockets
from mcp.server.fastmcp import FastMCP

# Configure logging strictly to stderr to keep MCP stdio stream clean
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger("ChromeAgentBridge")

# Initialize FastMCP Server
mcp = FastMCP(
    "Chrome Agent Bridge",
    instructions="Control real Google Chrome tabs, inspect page contents, and organize browser sessions."
)

WS_HOST = "127.0.0.1"
WS_PORT = 8765

# State management
extension_ws: Optional[Any] = None
pending_requests: Dict[str, asyncio.Future] = {}


async def send_command_to_chrome(action: str, params: Optional[Dict[str, Any]] = None, timeout: float = 25.0) -> Any:
    """Send an action to the connected Chrome Extension and await the result."""
    global extension_ws, pending_requests

    if extension_ws is None:
        raise RuntimeError(
            "Chrome Agent Bridge extension is not connected → "
            "Please make sure Google Chrome is open with the Chrome Agent Bridge extension enabled."
        )

    req_id = f"mcp_{uuid.uuid4().hex[:10]}"
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_requests[req_id] = future

    payload = {
        "id": req_id,
        "action": action,
        "params": params or {}
    }

    try:
        await extension_ws.send(json.dumps(payload))
        response = await asyncio.wait_for(future, timeout=timeout)
        if not response.get("success", False):
            raise RuntimeError(response.get("error", "Unknown error in Chrome extension"))
        return response.get("result")
    except asyncio.TimeoutError:
        raise RuntimeError(f"Request timeout after {timeout}s waiting for Chrome tab response → {action}")
    finally:
        pending_requests.pop(req_id, None)


# --- MCP Tools ---

@mcp.tool()
async def get_open_tabs() -> str:
    """
    Get a list of all currently open tabs across all Google Chrome windows.
    Returns: JSON string with tab id, windowId, title, url, active status, pinned, and groupId.
    """
    result = await send_command_to_chrome("get_tabs")
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def close_tabs(tab_ids: Union[List[int], int]) -> str:
    """
    Close one or more tabs in Google Chrome by their tab ID(s).
    Args:
        tab_ids: A single integer tab ID or a list of integer tab IDs to close.
    """
    ids = [tab_ids] if isinstance(tab_ids, int) else tab_ids
    result = await send_command_to_chrome("close_tabs", {"tab_ids": ids})
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def close_duplicate_tabs() -> str:
    """
    Automatically detect tabs with identical URLs and close duplicate tabs, leaving only one open.
    Returns: JSON summary of closed duplicate tabs count and details.
    """
    result = await send_command_to_chrome("close_duplicate_tabs")
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def get_tab_content(tab_id: int) -> str:
    """
    Read the clean innerText content of an open tab's webpage (works even for authenticated sessions).
    Args:
        tab_id: The ID of the tab to inspect.
    """
    result = await send_command_to_chrome("get_page_text", {"tab_id": tab_id})
    return result.get("text", "")


@mcp.tool()
async def focus_tab(tab_id: int) -> str:
    """
    Bring a specific tab to the foreground and focus its Chrome window.
    Args:
        tab_id: The tab ID to activate.
    """
    result = await send_command_to_chrome("activate_tab", {"tab_id": tab_id})
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def open_tab(url: str) -> str:
    """
    Open a new tab in Google Chrome with the given URL.
    Args:
        url: The web URL to navigate to.
    """
    result = await send_command_to_chrome("create_tab", {"url": url})
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def group_tabs() -> str:
    """
    Automatically group all open tabs into colored Chrome tab groups categorized by domain name.
    """
    result = await send_command_to_chrome("group_tabs_by_domain")
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def ungroup_all_tabs() -> str:
    """
    Ungroup all tabs across all Google Chrome windows (removes all Chrome tab groups).
    """
    result = await send_command_to_chrome("ungroup_all_tabs")
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def smart_organize() -> str:
    """
    Semantically organize all open Chrome tabs across 3 main windows into styled Chrome tab groups:
    - Window 1 → AI_TECH (purple: ИИ & Нейросети) + SERVICES (green: Общение & Сервер)
    - Window 2 → AUTO_VIN (cyan: Vincode & Авто)
    - Window 3 → CAREER_VIBE (blue: Вайбкодинг & Карьера) + MEDIA_FUN (red: Отдых, Спорт & Музыка)
    Consolidates tabs and closes redundant empty windows.
    """
    tabs = await send_command_to_chrome("get_tabs")
    if not tabs:
        return json.dumps({"success": True, "windows_count": 0, "groups": []})

    groups = {
        "AI": [],
        "SERVICES": [],
        "AUTO": [],
        "CAREER": [],
        "MEDIA": [],
        "OTHER": []
    }

    for t in tabs:
        text = f"{t.get('url', '')} {t.get('title', '')}".lower()
        tid = t["id"]

        career_kws = ['вайбкодинг', 'заказ', 'клиент', 'фриланс', 'джун', 'стажер', 'работу в it', 'web3', 'нейронайм', 'портфолио']
        ai_kws = ['grok', 'x.ai', 'claude', 'notebooklm', 'antigravity', 'qwen', 'chatgpt', 'gemini', 'deepseek', 'llm', 'blender', 'three.js', 'threejs', 'awwwards', 'layers.to', 'bentogrids', 'minimal.gallery', 'recent.design']
        auto_kws = ['vin', 'vininspector', 'alshnedauto', 'partsgiant', 'partsdeal', 'subaru', 'mopar', 'infiniti', 'mercedes', 'ford', 'nhtsa', 'motorhome', 'chassis', 'автозапчаст']
        srv_kws = ['whatsapp', 'mail.google', 'gmail', 'fastpanel', ':8888', 'digitalocean', 'cloudways', 'paypal', 'cloud.google', 'extensions']
        media_kws = ['kinect', 'pegasus', 'transformers', 'beast wars', 'пустоши', 'japan got talent', 'reels', 'instagram', 'standup', 'музыка', 'юмор', 'youtube.com', 'youtu.be']

        if any(k in text for k in career_kws):
            groups["CAREER"].append(tid)
        elif any(k in text for k in ai_kws):
            groups["AI"].append(tid)
        elif any(k in text for k in auto_kws):
            groups["AUTO"].append(tid)
        elif any(k in text for k in srv_kws):
            groups["SERVICES"].append(tid)
        elif any(k in text for k in media_kws):
            groups["MEDIA"].append(tid)
        else:
            groups["OTHER"].append(tid)

    plan = []
    if groups["AI"]:
        plan.append({"title": "ИИ & Нейросети", "color": "purple", "tab_ids": groups["AI"], "window_id": 1})
    if groups["SERVICES"]:
        plan.append({"title": "Общение & Сервер", "color": "green", "tab_ids": groups["SERVICES"], "window_id": 1})
    if groups["AUTO"]:
        plan.append({"title": "Vincode & Авто", "color": "cyan", "tab_ids": groups["AUTO"], "window_id": 2})
    if groups["CAREER"]:
        plan.append({"title": "Вайбкодинг & Карьера", "color": "blue", "tab_ids": groups["CAREER"], "window_id": 3})
    if groups["MEDIA"]:
        plan.append({"title": "Отдых, Спорт & Музыка", "color": "red", "tab_ids": groups["MEDIA"], "window_id": 3})
    if groups["OTHER"]:
        plan.append({"title": "Прочее & Поиск", "color": "grey", "tab_ids": groups["OTHER"], "window_id": 3})

    result = await send_command_to_chrome("apply_layout", {
        "groups": plan,
        "close_empty_windows": True
    })
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
async def apply_layout(groups: list[dict], close_empty_windows: bool = True) -> str:
    """
    Apply an AI-generated tab layout: move tabs to designated windows and create styled colored Chrome tab groups.
    Args:
        groups: List of group objects:
                [{'title': str, 'color': str ('blue'|'cyan'|'green'|'yellow'|'orange'|'red'|'pink'|'purple'|'grey'),
                  'tab_ids': list[int], 'window_id': int | str}]
        close_empty_windows: Whether to close redundant empty Chrome windows (default True).
    """
    result = await send_command_to_chrome("apply_layout", {
        "groups": groups,
        "close_empty_windows": close_empty_windows
    })
    return json.dumps(result, ensure_ascii=False, indent=2)



# --- WebSocket Handler ---

async def handle_ws_client(ws):
    """Handle incoming WebSocket connections from Chrome extension or CLI tools."""
    global extension_ws
    is_extension = False

    logger.info("New WebSocket connection established → %s", ws.remote_address)

    try:
        async for message in ws:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            # Heartbeat ping/pong
            if msg_type == "ping":
                await ws.send(json.dumps({"type": "pong"}))
                continue
            if msg_type == "pong":
                continue

            # Extension handshake
            if msg_type == "hello" and data.get("role") == "chrome_extension":
                is_extension = True
                extension_ws = ws
                logger.info("Chrome Extension registered successfully → v%s", data.get("version", "1.0"))
                continue

            # Extension response to an earlier request
            req_id = data.get("id")
            if req_id and ("success" in data or "result" in data or "error" in data):
                future = pending_requests.get(req_id)
                if future and not future.done():
                    future.set_result(data)
                continue

            # CLI Command Request (from console.php or external clients)
            action = data.get("action")
            if action:
                params = data.get("params", {})
                cli_req_id = data.get("id", str(uuid.uuid4()))
                try:
                    res = await send_command_to_chrome(action, params)
                    await ws.send(json.dumps({
                        "id": cli_req_id,
                        "success": True,
                        "result": res
                    }))
                except Exception as err:
                    await ws.send(json.dumps({
                        "id": cli_req_id,
                        "success": False,
                        "error": str(err)
                    }))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if is_extension or ws is extension_ws:
            extension_ws = None
            logger.info("Chrome Extension disconnected → waiting for reconnection...")


async def main():
    ws_only = "--ws-only" in sys.argv

    # Start WebSocket server
    ws_server = await websockets.serve(handle_ws_client, WS_HOST, WS_PORT)
    logger.info("Chrome Agent Bridge WebSocket server listening on ws://%s:%d → Ready", WS_HOST, WS_PORT)

    if ws_only:
        # Keep running WebSocket server only
        try:
            await asyncio.Future()
        except (asyncio.CancelledError, KeyboardInterrupt):
            pass
        finally:
            ws_server.close()
            await ws_server.wait_closed()
    else:
        # Run stdio MCP server for Antigravity IDE / Claude Desktop
        try:
            await mcp.run_stdio_async()
        finally:
            ws_server.close()
            await ws_server.wait_closed()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        sys.stderr.write("\nChrome Agent Bridge stopped.\n")
