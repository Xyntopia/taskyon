#!/bin/bash

# Create a new session
session_response=$(curl -X POST http://localhost:4444/wd/hub/session \
-H "Accept: application/json" \
-H "Content-Type: application/json;charset=UTF-8" \
-d '{"capabilities": {"firstMatch": [{}], "alwaysMatch": {"browserName": "chrome", "pageLoadStrategy": "normal", "goog:chromeOptions": {"extensions": [], "args": []}}}}')

session_id=$(echo "$session_response" | grep -oP '(?<=sessionId":")[^"]*')

# Navigate to URL
curl -X POST http://localhost:4444/wd/hub/session/$session_id/url \
-H 'Content-Type: application/json;charset=UTF-8' \
-H 'Accept: application/json'
-d '{"url": "https://example.com"}'

# Get page title
title_response=$(curl -X GET http://localhost:4444/wd/hub/session/$session_id/title \
-H 'Content-Type: application/json;charset=UTF-8' \
-H 'Accept: application/json'

echo "$title_response" | grep -oP '(?<=value":")[^"]*'

# Get page source
source_response=$(curl -X GET http://localhost:4444/wd/hub/session/$session_id/source \
-H 'Content-Type: application/json;charset=UTF-8' \
-H 'Accept: application/json'

echo "$source_response" | grep -oP '(?<=value":")[^"]*'

# Delete session
curl -X DELETE http://localhost:4444/wd/hub/session/$session_id \
-H 'Content-Type: application/json;charset=UTF-8' \
-H 'Accept: application/json'
