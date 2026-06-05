FROM mcr.microsoft.com/playwright:v1.58.0-noble

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        fluxbox \
        nginx \
        novnc \
        websockify \
        x11vnc \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY docker/lookup-browser-entrypoint.sh /usr/local/bin/lookup-browser-entrypoint.sh
COPY docker/lookup-browser-nginx.conf /etc/nginx/nginx.conf
RUN chmod +x /usr/local/bin/lookup-browser-entrypoint.sh \
    && ln -sf vnc.html /usr/share/novnc/index.html

ENV DISPLAY=:99
ENV CHROME_USER_DATA_DIR=/data/profile

EXPOSE 6080 9223

ENTRYPOINT ["/usr/local/bin/lookup-browser-entrypoint.sh"]
