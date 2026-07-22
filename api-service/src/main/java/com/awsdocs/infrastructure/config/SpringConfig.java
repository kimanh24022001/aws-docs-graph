package com.awsdocs.infrastructure.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCache;
import org.springframework.cache.support.SimpleCacheManager;
import org.springframework.context.annotation.Bean;

@SpringBootApplication(scanBasePackages = "com.awsdocs")
@EnableCaching
public class SpringConfig {

  public static void main(String[] args) {
    SpringApplication.run(SpringConfig.class, args);
  }

  @Bean
  public CacheManager cacheManager() {
    var overview =
        new CaffeineCache(
            "graph-overview",
            Caffeine.newBuilder()
                .expireAfterWrite(24, TimeUnit.HOURS)
                .maximumSize(10)
                .build());
    var clusters =
        new CaffeineCache(
            "graph-clusters",
            Caffeine.newBuilder()
                .expireAfterWrite(1, TimeUnit.HOURS)
                .maximumSize(100)
                .build());
    var manager = new SimpleCacheManager();
    manager.setCaches(List.of(overview, clusters));
    return manager;
  }
}
