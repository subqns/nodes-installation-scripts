#!/usr/bin/env bash

ssh testnet-node-1-dev1 'cd cere-network && docker-compose restart boot_node'
ssh testnet-node-2-dev1 'cd cere-network && docker-compose restart add_validation_node_custom'
