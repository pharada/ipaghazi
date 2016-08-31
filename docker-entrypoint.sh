#!/bin/sh
set -e
if [ -e /etc/ipaghazi/config.sh ]; then
    . /etc/ipaghazi/config.sh
fi
exec npm start
