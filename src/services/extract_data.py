def extract_alpr_data(results):
    extracted = None
    for result in results:
        data = {}
        
        if result.ocr:
            data['plate'] = result.ocr.text or "N/A"
            data['ocr_conf'] = result.ocr.confidence or 0.0
        else:
            data['plate'] = "N/A"
            data['ocr_conf'] = 0.0
        
        if result.detection:
            data['det_conf'] = result.detection.confidence or 0.0
            
            if result.detection.bounding_box:
                bbox = result.detection.bounding_box
                data['bbox'] = (bbox.x1, bbox.y1, bbox.x2, bbox.y2)
            else:
                data['bbox'] = None
        else:
            data['det_conf'] = 0.0
            data['bbox'] = None
        
        extracted = data
    
    return extracted
