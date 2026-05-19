# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

ARG USERNAME=vscode

ENV LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8 \
    LANGUAGE=pt_BR:pt:en \
    TERM=xterm-256color \
    COLORTERM=truecolor

WORKDIR /workspaces/agents-lab

RUN apt-get update \
  && apt-get install -y --no-install-recommends locales \
  && sed -i 's/^# *pt_BR.UTF-8 UTF-8/pt_BR.UTF-8 UTF-8/' /etc/locale.gen \
  && locale-gen pt_BR.UTF-8 \
  && update-locale LANG=pt_BR.UTF-8 LC_ALL=pt_BR.UTF-8 LANGUAGE=pt_BR:pt:en \
  && rm -rf /var/lib/apt/lists/*

# Workspace-local runtime directory (mounted project will persist it).
RUN mkdir -p /workspaces/agents-lab/.sandbox/pi-agent \
  && chown -R 1000:1000 /workspaces/agents-lab

# Enter the operator shell from Docker Desktop root terminals.
COPY lab /usr/local/bin/lab
RUN chmod +x /usr/local/bin/lab
