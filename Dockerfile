FROM node:6.4.0
MAINTAINER Sam Harada <sam@pharada.org>
RUN mkdir -p /etc/ipaghazi /usr/src/app
WORKDIR /usr/src/app
RUN npm install -g bower
COPY . /usr/src/app
RUN npm install && bower --allow-root install
VOLUME /etc/ipaghazi
EXPOSE 80
CMD ["./docker-entrypoint.sh"]
