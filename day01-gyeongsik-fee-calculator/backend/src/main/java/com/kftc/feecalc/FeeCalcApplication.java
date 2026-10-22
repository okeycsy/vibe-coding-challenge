package com.kftc.feecalc;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class FeeCalcApplication {

    public static void main(String[] args) {
        SpringApplication.run(FeeCalcApplication.class, args);
    }
}
