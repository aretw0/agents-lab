# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/devcontainers/typescript-node:24-bookworm

ARG USERNAME=vscode

ENV LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8 \
    LANGUAGE=pt_BR:pt:en \
    TERM=xterm-256color \
    COLORTERM=truecolor

WORKDIR /workspaces/agents-lab

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash-completion \
    bubblewrap \
    build-essential \
    ca-certificates \
    curl \
    fd-find \
    git-lfs \
    hyperfine \
    jq \
    locales \
    ripgrep \
    ruby-full \
    shellcheck \
    shfmt \
    tree \
    unzip \
    zlib1g-dev \
  && sed -i 's/^# *pt_BR.UTF-8 UTF-8/pt_BR.UTF-8 UTF-8/' /etc/locale.gen \
  && locale-gen pt_BR.UTF-8 \
  && update-locale LANG=pt_BR.UTF-8 LC_ALL=pt_BR.UTF-8 LANGUAGE=pt_BR:pt:en \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && gem install bundler --no-document \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI is a baseline operator/agent tool for repo work inside the sandbox.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Workspace-local runtime directory (mounted project will persist it).
RUN mkdir -p /workspaces/agents-lab/.sandbox/pi-agent \
  && chown -R 1000:1000 /workspaces/agents-lab

# Enter the operator shell from Docker Desktop root terminals.
COPY lab /usr/local/bin/lab
RUN chmod +x /usr/local/bin/lab
