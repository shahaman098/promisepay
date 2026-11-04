// Entry point: build the app and listen.

import { buildApp } from "./app.js";
import * as store from "./store.js";
import * as paypal from "./paypal.js";

store.load();
const app = buildApp();
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`PromisePay (${paypal.mode()} mode) listening on :${port}`));
