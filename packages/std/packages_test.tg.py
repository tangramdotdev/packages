from typing import Literal, TypedDict


class Spec(TypedDict, closed=True):
    build: tg.Command
    kind: Literal["full"]


async def dependency(arg: dict[str, tg.Value.Type]) -> tg.Directory:
    message = arg["message"]
    assert isinstance(message, str)
    return await tg.directory({"message": await tg.file(message)})


async def deps() -> dict[str, Spec]:
    return {"python": {"build": await tg.command(dependency), "kind": "full"}}
