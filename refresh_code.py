#!/usr/bin/env python3
"""
Live Room Code Refresh Script
自动获取直播间列表，按名称过滤后刷新验证码，并汇总推送到企业微信。
"""

from dataclasses import dataclass
from typing import Dict, List
import os
import requests


LIVE_LIST_PAYLOAD = {
    "pageInfo": {"orderBy": "", "pageNum": 1, "pageSize": 1000, "total": 100, "pages": 10},
    "param": {},
}


@dataclass
class ServerConfig:
    alias: str
    url: str


@dataclass
class LiveRoomResult:
    name: str
    code: str
    success: bool
    message: str = ""


class LiveCodeRefresher:
    """按服务器批量刷新直播间验证码，并聚合推送"""

    def __init__(self, servers: List[ServerConfig], token: str, live_names: List[str], webhook_key: str):
        self.servers = servers
        self.token = token
        self.live_names = live_names
        self.webhook_url = f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={webhook_key}"
        self.session = requests.Session()

    # ----------------- 请求封装 -----------------
    def _headers(self) -> Dict[str, str]:
        return {"Content-Type": "application/json", "Token": self.token}

    def fetch_live_list(self, server: ServerConfig) -> List[Dict]:
        endpoint = f"https://{server.url}/api/live/liveList"
        response = self.session.post(endpoint, json=LIVE_LIST_PAYLOAD, headers=self._headers(), timeout=15)
        response.raise_for_status()
        data = response.json()

        if not data.get("meta", {}).get("success"):
            raise ValueError(data.get("meta", {}).get("message", "获取直播列表失败"))

        live_list = data.get("data", [])
        if not isinstance(live_list, list):
            raise ValueError("直播列表数据格式异常")
        return live_list

    def refresh_room_code(self, server: ServerConfig, live_id: str) -> LiveRoomResult:
        endpoint = f"https://{server.url}/api/live/refreshVerifyCode"
        response = self.session.post(endpoint, json={"param": live_id}, headers=self._headers(), timeout=15)
        response.raise_for_status()
        data = response.json()

        success = bool(data.get("meta", {}).get("success"))
        code = data.get("data", {}).get("code") or data.get("meta", {}).get("message", "刷新失败")
        return LiveRoomResult(name="", code=str(code), success=success, message="" if success else str(code))

    def refresh_multi_room_code(self, server: ServerConfig, live_ids: List[str]) -> LiveRoomResult:
        endpoint = f"https://{server.url}/api/live/batchRefVerifyCode"
        response = self.session.post(endpoint, json={"param": ",".join(live_ids)}, headers=self._headers(), timeout=15)
        response.raise_for_status()
        data = response.json()

        success = bool(data.get("meta", {}).get("success"))
        # 响应格式: data 直接是验证码字符串，如 "3200"
        code = data.get("data") or data.get("meta", {}).get("message", "刷新失败")
        return LiveRoomResult(name="", code=str(code), success=success, message="" if success else str(code))

    # ----------------- 业务逻辑 -----------------
    def _parse_live_name_groups(self) -> List[List[str]]:
        """解析 live_names，支持 | 分隔的多房间组"""
        return [[n.strip() for n in item.split("|") if n.strip()] for item in self.live_names if item]

    def filter_live_rooms(self, live_list: List[Dict]) -> List[Dict]:
        """根据名称组匹配直播间，返回分组结构 [{"names": [...], "rooms": [...]}]"""
        groups = self._parse_live_name_groups()
        result = []
        for name_group in groups:
            rooms = []
            for target in name_group:
                for room in live_list:
                    room_name = str(room.get("name", ""))
                    if room_name and target in room_name:
                        rooms.append(room)
                        break
            if rooms:
                result.append({"names": name_group, "rooms": rooms})
        return result

    def refresh_server(self, server: ServerConfig) -> Dict:
        print(f"正在处理服务器 [{server.alias}] ...")
        result: Dict = {"alias": server.alias, "rooms": [], "success": False, "error": None}

        try:
            live_list = self.fetch_live_list(server)
        except Exception as exc:  # noqa: BLE001 - 需要捕获所有异常用于反馈
            result["error"] = f"获取直播列表失败：{exc}"
            print(f"[{server.alias}] {result['error']}")
            return result

        matched_groups = self.filter_live_rooms(live_list)
        if not matched_groups:
            result["error"] = "未匹配到任何需要刷码的直播间"
            print(f"[{server.alias}] {result['error']}")
            return result

        for group in matched_groups:
            display_name = "|".join(group["names"])
            live_ids = [str(room.get("id")) for room in group["rooms"] if room.get("id")]

            if not live_ids:
                msg = "缺少直播间 ID，无法刷码"
                result["rooms"].append(LiveRoomResult(name=display_name, code=msg, success=False, message=msg))
                continue

            try:
                if len(live_ids) == 1:
                    refresh_result = self.refresh_room_code(server, live_ids[0])
                else:
                    refresh_result = self.refresh_multi_room_code(server, live_ids)
                refresh_result.name = display_name
                result["rooms"].append(refresh_result)
                status = "成功" if refresh_result.success else f"失败：{refresh_result.message}"
                print(f"[{server.alias}] {display_name} 刷码{status}")
            except Exception as exc:  # noqa: BLE001
                message = f"刷码异常：{exc}"
                print(f"[{server.alias}] {display_name} {message}")
                result["rooms"].append(LiveRoomResult(name=display_name, code=message, success=False, message=message))

        result["success"] = bool(result["rooms"]) and all(room.success for room in result["rooms"])
        return result

    def refresh_all(self) -> List[Dict]:
        return [self.refresh_server(server) for server in self.servers]

    # ----------------- 推送 -----------------
    def build_message(self, server_result: Dict) -> str:
        alias = server_result.get("alias", "unknown")

        if server_result.get("error"):
            return f"【{alias}】刷码失败\n原因：{server_result['error']}"

        all_success = server_result.get("success", False)
        header = "刷码成功" if all_success else "刷码完成（部分失败）"
        lines = [f"【{alias}】{header}"]

        rooms: List[LiveRoomResult] = server_result.get("rooms", [])
        if not rooms:
            lines.append("未匹配到需要刷码的直播间")
        else:
            for room in rooms:
                if room.success:
                    lines.append(f"{room.name}:{room.code}")
                else:
                    lines.append(f"{room.name} 刷码失败：{room.message}")

        return "\n".join(lines)

    def send_notification(self, server_result: Dict) -> bool:
        payload = {"msgtype": "text", "text": {"content": self.build_message(server_result)}}

        try:
            response = self.session.post(self.webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            result = response.json()

            if result.get("errcode") == 0:
                print(f"[{server_result.get('alias', 'unknown')}] 通知发送成功")
                return True
            print(f"[{server_result.get('alias', 'unknown')}] 通知发送失败: {result.get('errmsg', '未知错误')}")
        except Exception as exc:  # noqa: BLE001
            print(f"[{server_result.get('alias', 'unknown')}] 发送通知异常: {exc}")

        return False

    def run(self) -> None:
        print("=" * 60)
        print("开始刷新直播间验证码...")
        print("=" * 60)

        results = self.refresh_all()
        if not results:
            print("没有可刷新的服务器")
            return

        print("\n" + "=" * 60)
        print("刷新完成，开始推送...")
        print("=" * 60)

        for result in results:
            self.send_notification(result)


def _parse_list(env_key: str) -> List[str]:
    raw = os.getenv(env_key, "")
    items = [item.strip() for item in raw.split(",") if item.strip()]
    if not items:
        raise ValueError(f"{env_key} 未配置")
    return items


def load_config_from_env() -> tuple[List[ServerConfig], str, List[str], str]:
    """从环境变量读取配置"""

    aliases = _parse_list("SERVER_ALIAS_LIST")
    urls = _parse_list("SERVER_URL_LIST")
    if len(aliases) != len(urls):
        raise ValueError("SERVER_ALIAS_LIST 与 SERVER_URL_LIST 数量不一致")

    servers = [ServerConfig(alias=alias, url=url) for alias, url in zip(aliases, urls)]

    live_names = _parse_list("LIVE_NAME_LIST")
    token = os.getenv("SERVER_TOKEN", "").strip()
    if not token:
        raise ValueError("SERVER_TOKEN 未配置")

    webhook_key = os.getenv("WECHAT_WEBHOOK_KEY", "").strip()
    if not webhook_key:
        raise ValueError("WECHAT_WEBHOOK_KEY 未配置")

    return servers, token, live_names, webhook_key


def main() -> None:
    try:
        servers, token, live_names, webhook_key = load_config_from_env()
        refresher = LiveCodeRefresher(servers, token, live_names, webhook_key)
        refresher.run()
    except Exception as exc:  # noqa: BLE001
        print(f"程序执行失败: {exc}")
        raise


if __name__ == "__main__":
    main()
