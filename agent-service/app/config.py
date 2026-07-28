from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_username: str = "neo4j"
    neo4j_password: str = "devpassword"
    anthropic_api_key: str = ""
    # Always use real Anthropic API — ignore corporate proxy env vars
    anthropic_base_url: str = "https://api.anthropic.com"
    environment: str = "local"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
