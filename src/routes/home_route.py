from fasthtml.common import Title, Div, Canvas, Button, Script, Video, Input

js_file = ""
with open("static/plat-cr.js", "r") as f:
    js_file = f.read()

def home(rt):
    @rt('/')
    def get():
        return Title("PLATE"), Div(
            # Video + Canvas overlay (full screen)
            Div(
                Video(
                    id="video",
                    autoplay=True,
                    playsinline=True,
                    style="""
                        display: block;
                        object-fit: cover;
                        width: 100%;
                        height: 100%;
                    """
                ),
                Canvas(
                    id="canvas",
                    style="""
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        pointer-events: none;
                    """
                ),
                style="""
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 1;
                """
            ),
            # Controls overlay (fixed at bottom)
            Div(
                Div(
                    Button("Start Camera", id="start-btn", cls="btn"),
                    Button("Start Streaming", id="stream-btn", cls="btn", disabled=True),
                    Button("Stop Streaming", id="stop-stream-btn", cls="btn", disabled=True),
                    style="display: flex; flex-direction: row; gap: 0.5rem; flex-wrap: wrap; justify-content: center;"
                ),
                # Div(
                #     Input("Height", placeholder="height", type="number", id="crop-height", cls="input", style="width: 100px;"),
                #     Input("Width", placeholder="width", type="number", id="crop-width", cls="input", style="width: 100px;"),
                #     style="display: flex; flex-direction: row; gap: 0.5rem; justify-content: center;"
                # ),
                Div(id="status", style="color: #888; margin-top: 0.5rem; text-align: center; font-size: 0.875rem;"),
                id="control-buttons",
                style="""
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.75rem;
                    z-index: 20;
                    background: rgba(0, 0, 0, 0.7);
                    padding: 1rem;
                    max-height: 30vh;
                    overflow-y: auto;
                """
            ),
            Div(id="data-list", style="display: none;"),
            Script(f"{js_file}"),
            style="""
                padding: 0;
                margin: 0;
                width: 100vw;
                height: 100vh;
                overflow: hidden;
            """
        )