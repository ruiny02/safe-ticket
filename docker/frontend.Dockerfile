FROM nginx:1.27-alpine

RUN printf '%s\n' \
  '<!doctype html>' \
  '<html lang="ko">' \
  '<head><meta charset="utf-8"><title>safe-ticket frontend placeholder</title></head>' \
  '<body><h1>Frontend placeholder</h1><p>React/Figma scaffold will be added later.</p></body>' \
  '</html>' \
  > /usr/share/nginx/html/index.html
