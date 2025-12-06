#!/usr/bin/env python3
"""
Live Room Code Refresh Script
自动刷新直播间验证码并推送到企业微信
"""

import os
import json
import requests
from typing import List, Dict, Optional
from dataclasses import dataclass


@dataclass
class ServerConfig:
    """服务器配置"""
    alias: str
    url: str
    token: str
    room_id: str


class LiveCodeRefresher:
    """直播间验证码刷新器"""

    def __init__(self, servers: List[ServerConfig], webhook_key: str):
        self.servers = servers
        self.webhook_url = f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={webhook_key}"

    def refresh_code(self, server: ServerConfig) -> Optional[Dict]:
        """
        刷新单个服务器的验证码

        Args:
            server: 服务器配置

        Returns:
            成功返回响应数据，失败返回 None
        """
        url = f"https://{server.url}/api/live/refreshVerifyCode"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {server.token}"
        }
        payload = {"param": server.room_id}

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()

            if data.get("meta", {}).get("success"):
                return {
                    "alias": server.alias,
                    "code": data.get("data", {}).get("code", "N/A"),
                    "success": True
                }
            else:
                message = data.get("meta", {}).get("message", "刷新失败")
                print(f"[{server.alias}] 刷新失败: {message}")
                return {
                    "alias": server.alias,
                    "code": message,
                    "success": False
                }
        except Exception as e:
            print(f"[{server.alias}] 请求异常: {str(e)}")
            return {
                "alias": server.alias,
                "code": str(e),
                "success": False
            }

    def refresh_all(self) -> List[Dict]:
        """
        刷新所有服务器的验证码

        Returns:
            所有服务器的刷新结果列表
        """
        results = []
        for server in self.servers:
            print(f"正在刷新 [{server.alias}] ...")
            result = self.refresh_code(server)
            if result:
                results.append(result)
        return results

    def send_notification(self, result: Dict) -> bool:
        """按服务器分别发送文本通知到企业微信"""
        alias = result.get("alias", "unknown")
        code = result.get("code", "N/A")
        success = result.get("success", False)
        status = "刷码成功" if success else "刷码失败"
        details = f"验证码：{code}" if success else f"原因：{code}"

        payload = {
            "msgtype": "text",
            "text": {
                "content": f"[{alias}]{status} {details}"
            }
        }

        try:
            response = requests.post(self.webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            result = response.json()

            if result.get("errcode") == 0:
                print(f"[{alias}] 通知发送成功！")
                return True
            else:
                print(f"[{alias}] 通知发送失败: {result.get('errmsg', 'Unknown error')}")
                return False
        except Exception as e:
            print(f"[{alias}] 发送通知异常: {str(e)}")
            return False

    def run(self):
        """执行完整的刷新流程"""
        print("=" * 50)
        print("开始刷新直播间验证码...")
        print("=" * 50)

        results = self.refresh_all()

        if not results:
            print("没有获取到任何结果")
            return

        print("\n" + "=" * 50)
        print("刷新完成，发送通知...")
        print("=" * 50)
        for result in results:
            self.send_notification(result)


def load_config_from_env() -> tuple[List[ServerConfig], str]:
    """
    从环境变量加载配置

    Returns:
        (服务器配置列表, webhook key)
    """
    servers = []

    # 加载三个服务器配置
    for alias in ["EAST", "WEST", "HEBEI"]:
        url = os.getenv(f"{alias}_URL")
        token = os.getenv(f"{alias}_TOKEN")
        room_id = os.getenv(f"{alias}_ROOM_ID")

        if url and token and room_id:
            servers.append(ServerConfig(
                alias=alias.lower(),
                url=url,
                token=token,
                room_id=room_id
            ))
        else:
            print(f"警告: {alias} 配置不完整，已跳过")

    # 加载企业微信 webhook key
    webhook_key = os.getenv("WECHAT_WEBHOOK_KEY", "")

    if not webhook_key:
        raise ValueError("WECHAT_WEBHOOK_KEY 环境变量未设置")

    if not servers:
        raise ValueError("没有配置任何服务器")

    return servers, webhook_key


def main():
    """主函数"""
    try:
        servers, webhook_key = load_config_from_env()
        refresher = LiveCodeRefresher(servers, webhook_key)
        refresher.run()
    except Exception as e:
        print(f"程序执行失败: {str(e)}")
        exit(1)


if __name__ == "__main__":
    main()
