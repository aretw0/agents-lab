# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

ARG USERNAME=vscode

WORKDIR /workspaces/agents-lab

# Workspace-local runtime directory (mounted project will persist it).
RUN mkdir -p /workspaces/agents-lab/.sandbox/pi-agent \
  && chown -R ${USERNAME}:${USERNAME} /workspaces/agents-lab
