from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "CS2余额助手"
    environment: str = "development"
    api_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./data/cs2_balance.db"

    collect_interval_minutes: int = 30
    steam_currency: int = 23
    steam_appid: int = 730
    steam_req_delay_seconds: float = 3.0
    steam_cookie: str = ""

    c5_openapi_base: str = "https://openapi.c5game.com"
    c5_app_key: str = ""
    c5_api_base: str = "https://www.c5game.com/api"

    lock_days: int = 7
    lock_mode: str = "exact_hours"
    lock_hours: int = 168

    log_level: str = "INFO"

    # 手机端 后端服务地址（用于文档/示例）
    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
