from fastapi import FastAPI
from flask import Flask, render_template
from asgiref.wsgi import WsgiToAsgi

from .api import router

flask_app = Flask(__name__, template_folder="templates", static_folder="static")


@flask_app.get("/")
def home():
    return render_template("home.html")


@flask_app.get("/jeux")
def games():
    return render_template("games.html")


app = FastAPI(title="Médiathèque - Réservations", version="0.1.0")
app.include_router(router)
app.mount("/", WsgiToAsgi(flask_app))
