import { onRequestPost as __api_loans_batch_js_onRequestPost } from "C:\\Users\\lvirbel-jeandel\\Documents\\Mediatheque\\Mediatheque\\worker\\functions\\api\\loans\\batch.js"
import { onRequestGet as __api_games_js_onRequestGet } from "C:\\Users\\lvirbel-jeandel\\Documents\\Mediatheque\\Mediatheque\\worker\\functions\\api\\games.js"
import { onRequestGet as __api_loans_js_onRequestGet } from "C:\\Users\\lvirbel-jeandel\\Documents\\Mediatheque\\Mediatheque\\worker\\functions\\api\\loans.js"

export const routes = [
    {
      routePath: "/api/loans/batch",
      mountPath: "/api/loans",
      method: "POST",
      middlewares: [],
      modules: [__api_loans_batch_js_onRequestPost],
    },
  {
      routePath: "/api/games",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_games_js_onRequestGet],
    },
  {
      routePath: "/api/loans",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_loans_js_onRequestGet],
    },
  ]