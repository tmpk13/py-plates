import cv2
import base64
import numpy as np
import json
from services.extract_data import extract_alpr_data as extract
# from services.database_interface import Database
from datetime import datetime

# db = Database("database/plat-database.db")

def stream(app, alpr, entries):
    @app.ws('/ws')
    async def ws_handler(msg: dict, send):
        try:
            frame_b64 = msg.get('frame', '')
            if not frame_b64:
                await send(json.dumps({"error": "No frame data"}))
                return
            
            count = msg.get('count', 0)
            
            # Strip data URL prefix if present
            if ',' in frame_b64:
                frame_b64 = frame_b64.split(',', 1)[1]
            
            # Decode base64 --> numpy array --> cv2 image
            img_data = base64.b64decode(frame_b64)
            nparr = np.frombuffer(img_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                await send(json.dumps({"error": "Decode failed"}))
                return
            
            height, width = img.shape[:2]
            
            alpr_data = None
            predictions = alpr.predict(img)
            
            if predictions:
                alpr_data = extract(predictions)
            
            # Store valid detections
            if alpr_data and alpr_data['plate'] and alpr_data['plate'] != "N/A":
                try:
                    entries.insert(0,
                        [
                            alpr_data['plate'], 
                            alpr_data['ocr_conf'], 
                            datetime.today().strftime('%H%M%S %Y-%m-%d')
                        ]
                    )
                except Exception as e:
                    print(f"Database ERROR: {e}")
            
            await send(json.dumps({
                "frame": count,
                "resolution": f"{width}x{height}",
                "predictions": alpr_data
            }))
                
        except Exception as e:
            print(f"WS error: {type(e).__name__}: {e}")
            await send(json.dumps({"error": str(e)}))
    
    return ws_handler