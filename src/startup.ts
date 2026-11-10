import { loadFrontend } from "./lib/load-frontend"

void loadFrontend(() => import("./main"))
