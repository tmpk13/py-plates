from fasthtml.common import *
import cv2
import base64
import numpy as np
import json

from services.database_interface import Database
from routes.home_route import home
from routes.websocket_stream import stream

from fast_alpr import ALPR
alpr = ALPR(
    detector_model="yolo-v9-t-384-license-plate-end2end",
    ocr_model="cct-s-v1-global-model", # cct-xs-v1-global-model
)


entries = []


hdrs=(
    Link(href="https://cdn.jsdelivr.net/npm/daisyui@5", rel="stylesheet", type="text/css"),
    Script(src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"),
)

app, rt = fast_app(pico=False, hdrs=hdrs)

home(rt)

stream(app, alpr, entries)

@app.post('/data-list')
def post():
    return Div(
            Ul(
                (Li(f"{i[0]} | {i[2]} | {i[1]}", cls="data") for i in entries),
                cls="",
                id="list"
            ),
            style="""
                position: fixed;
                bottom: 0;
                left: 75%;
                right: 0;
                max-height: 10vh;
                overflow-y: auto;
                background: rgba(255, 255, 255, 0.7);
                z-index: 15;
            """,
            cls="flex border border-base-300"
        )



serve(host="127.0.0.1", port=1300)