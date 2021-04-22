all:
	yarn && yarn build
	docker build -t btwiuse/nftmart:validator-setup .
	docker push btwiuse/nftmart:validator-setup
