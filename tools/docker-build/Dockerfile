FROM electronuserland/builder:latest

# Copy project files
WORKDIR /project
COPY . /project

# Install deps and build
RUN npm ci --production=false --no-audit --no-fund && \
    npm run build:linux || true

# Build outputs will be in /project/release-build
VOLUME ["/project/release-build"]

CMD ["/bin/bash"]
