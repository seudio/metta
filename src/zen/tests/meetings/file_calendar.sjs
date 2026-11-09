/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Answers with the body and content type given in the query string.
function handleRequest(request, response) {
  const params = new URLSearchParams(request.queryString);
  response.setHeader(
    "Content-Type",
    params.get("type") || "text/calendar",
    false
  );
  response.setHeader("Cache-Control", "no-store", false);
  response.write(params.get("body") || "");
}
