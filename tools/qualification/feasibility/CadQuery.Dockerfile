FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/cq-venv \
    PATH=/opt/cq-venv/bin:$PATH

COPY cadquery-requirements.lock /tmp/cadquery-requirements.lock

RUN apt-get -o Acquire::Retries=0 -o Acquire::ForceIPv4=true update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       libgl1 \
       libglib2.0-0 \
       libsm6 \
       libxext6 \
       libxrender1 \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv "$VIRTUAL_ENV" \
    && "$VIRTUAL_ENV/bin/python" -m pip install --upgrade pip setuptools wheel \
    && "$VIRTUAL_ENV/bin/python" -m pip install --requirement /tmp/cadquery-requirements.lock

WORKDIR /opt/qualification
ENTRYPOINT ["/opt/cq-venv/bin/python"]
