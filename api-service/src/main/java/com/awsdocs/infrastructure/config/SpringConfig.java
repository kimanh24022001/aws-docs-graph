package com.awsdocs.infrastructure.config;

import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;

@SpringBootApplication(scanBasePackages = "com.awsdocs")
@EnableCaching
public class SpringConfig {}
