"""Single-process local production entry point (built dist + API)."""
import uvicorn

if __name__ == '__main__':
    uvicorn.run('backend.app:app', host='127.0.0.1', port=8787, workers=1)
