#pragma once
/* The gate's network (cyb_net_t) in a web page: each request goes through
 * the page's fetch() to the proxy (proxy/), one redirect step at a time so
 * that every step gets and sets its cookies, as the curl port does. */
#include "cy_browser.h"

void net_web_init(cyb_net_t *net);
