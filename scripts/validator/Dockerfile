FROM debian:buster

WORKDIR /app

COPY bin/validator-setup /bin/validator-setup

RUN chmod +x /bin/validator-setup

ENTRYPOINT ["validator-setup"]
